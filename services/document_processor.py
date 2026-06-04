"""
Document processor — two-path strategy for speed:

  FAST PATH  (text PDF)  : PyMuPDF extracts embedded text directly → send text to Claude
  SLOW PATH  (scanned PDF): render pages as images → Claude Vision OCR

Most modern spec documents and many mill certs are text PDFs.
Scanned/image-only PDFs fall back to Vision automatically.
"""

import base64
import io
import json
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import anthropic
import fitz  # PyMuPDF
from PIL import Image, ImageEnhance
from config import ANTHROPIC_API_KEY, MAX_PAGES_SPEC, MAX_PAGES_CERT

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# If average chars/page exceeds this the PDF has enough embedded text
_TEXT_PATH_THRESHOLD = 200


# ── PDF text helpers ──────────────────────────────────────────────────────────

def _is_index_page(text: str) -> bool:
    lower = text.lower()
    indicators = ["table of contents", "contents", "index", "页码", "目录"]
    return any(ind in lower for ind in indicators) and len(text) < 800


def _is_text_pdf(file_path: str, max_pages: int) -> bool:
    """Return True when the PDF has substantial selectable text (fast path)."""
    doc = fitz.open(file_path)
    pages = min(len(doc), max_pages)
    total_chars = sum(len(doc[i].get_text().strip()) for i in range(pages))
    doc.close()
    return (total_chars / max(pages, 1)) > _TEXT_PATH_THRESHOLD


def _extract_pdf_text(file_path: str, max_pages: int, skip_index: bool = True) -> str:
    """Pull embedded text from every relevant page."""
    doc = fitz.open(file_path)
    parts = []
    for i in range(min(len(doc), max_pages)):
        page = doc[i]
        text = page.get_text().strip()
        if not text or len(text) < 60:
            continue
        if skip_index and _is_index_page(text):
            continue
        parts.append(f"--- Page {i + 1} ---\n{text}")
    doc.close()
    return "\n\n".join(parts)


# ── Image helpers (slow / Vision path) ───────────────────────────────────────

def _enhance(img: Image.Image) -> Image.Image:
    img = ImageEnhance.Contrast(img).enhance(1.4)
    img = ImageEnhance.Sharpness(img).enhance(1.5)
    return img


def _to_base64(img: Image.Image, max_dim: int = 1400) -> str:
    if img.width > max_dim or img.height > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=75, optimize=True)
    return base64.standard_b64encode(buf.getvalue()).decode()


def _page_has_content(page) -> bool:
    """Skip pages that are mostly charts/graphs/images (e.g. heat treatment curves, micrographs)."""
    blocks = page.get_text("blocks")
    text_blocks = [b for b in blocks if b[6] == 0]
    total_chars = sum(len(b[4].strip()) for b in text_blocks)
    return total_chars > 50


def _is_image_dominated(page) -> bool:
    """Skip page if images cover more than 80% of page area — micrographs, furnace charts, etc."""
    page_area = page.rect.width * page.rect.height
    if page_area == 0:
        return False
    img_area = sum(
        (i["bbox"][2] - i["bbox"][0]) * (i["bbox"][3] - i["bbox"][1])
        for i in page.get_image_info()
        if i.get("bbox")
    )
    return (img_area / page_area) > 0.80


def _pdf_to_images(file_path: str, max_pages: int, skip_sparse: bool = True) -> list:
    doc = fitz.open(file_path)
    images = []
    mat = fitz.Matrix(150 / 72, 150 / 72)   # 150 DPI — 44% smaller than 200 DPI, still sharp
    for i in range(min(len(doc), max_pages)):
        page = doc[i]
        if skip_sparse and _is_image_dominated(page):
            continue
        if skip_sparse and not _page_has_content(page):
            continue
        if _is_index_page(page.get_text()):
            continue
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(_enhance(img))
    doc.close()
    return images


def _image_content(images: list) -> list:
    return [
        {"type": "image", "source": {
            "type": "base64", "media_type": "image/jpeg",
            "data": _to_base64(img)
        }}
        for img in images
    ]


# ── JSON helpers ──────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    # Strip markdown fences
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    text = text.strip()

    # Attempt 1: direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Attempt 2: strip control characters
    cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Attempt 3: extract outermost { ... }
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Attempt 4: repair truncated JSON
    try:
        repaired = _repair_json(cleaned)
        return json.loads(repaired)
    except Exception:
        pass

    return {}


def _repair_json(text: str) -> str:
    """Close truncated JSON arrays/objects."""
    last = text.rfind("},")
    if last == -1:
        last = text.rfind("}")
    if last != -1:
        text = text[:last + 1].rstrip(",")
        open_brackets = text.count("[") - text.count("]")
        open_braces = text.count("{") - text.count("}")
        text += "]" * max(open_brackets, 0)
        text += "}" * max(open_braces, 0)
    return text


# ── Spec extraction ───────────────────────────────────────────────────────────

_SPEC_PROMPT = """You are a materials engineering expert.
Extract EVERY technical requirement from this specification document for '{name}'.
This includes BOTH numeric limits AND text/statement requirements (e.g. heat treatment condition,
delivery condition, NDE method, steelmaking process, compliance declarations, surface condition,
test standards, any other mandatory requirement stated in words).

IMPORTANT JSON RULES:
- Return ONLY valid JSON — no markdown fences, no text before or after
- Start your response directly with {{
- All string values must use double quotes
- No trailing commas

{{
  "material_name": "string",
  "standard": "string",
  "grade": "string",
  "revision": "string",
  "parameters": [
    {{
      "name": "full parameter name",
      "symbol": "chemical symbol or abbreviation if applicable",
      "category": "chemical | mechanical | dimensional | surface | compliance | other",
      "min_value": number_or_null,
      "max_value": number_or_null,
      "nominal_value": number_or_null,
      "unit": "%, MPa, mm, HB, ksi, J, or empty string if text requirement",
      "requirement_text": "full text of requirement if not numeric e.g. Solution annealed + age hardened",
      "is_critical": true,
      "notes": "any special condition or table reference"
    }}
  ]
}}

Rules:
- is_critical = true for: all chemical elements, tensile strength, yield strength, elongation, hardness, impact energy, heat treatment, NDE requirements.
- null min_value means no lower limit; null max_value means no upper limit.
- For text requirements: set min_value and max_value to null, put full requirement in requirement_text field.
- Include ALL parameters — do not omit any row, column, or statement from the document.
"""

_SPEC_PROMPT_TEXT = _SPEC_PROMPT + "\n\nDOCUMENT TEXT:\n{text}"


def extract_spec_params(file_path: str, spec_name: str) -> dict:
    """
    Extract parameters from a specification. Stored in DB — never re-scanned.
    Uses fast text path when PDF has selectable text; Vision OCR otherwise.
    """
    if _is_text_pdf(file_path, MAX_PAGES_SPEC):
        # ── FAST PATH ──
        text = _extract_pdf_text(file_path, MAX_PAGES_SPEC)
        if not text:
            raise ValueError("Could not extract text from specification.")
        messages = [{"role": "user", "content": [
            {"type": "text", "text": _SPEC_PROMPT_TEXT.format(name=spec_name, text=text)}
        ]}]
    else:
        # ── VISION PATH (scanned PDF) ──
        images = _pdf_to_images(file_path, MAX_PAGES_SPEC, skip_sparse=False)
        if not images:
            raise ValueError("Could not extract any readable pages from the specification.")
        content = _image_content(images)
        content.append({"type": "text", "text": _SPEC_PROMPT.format(name=spec_name)})
        messages = [{"role": "user", "content": content}]

    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        temperature=0,
        messages=messages,
    )

    raw = resp.content[0].text.strip()
    data = _parse_json(raw)
    if not data or "parameters" not in data:
        raise ValueError(f"Could not parse spec parameters. Raw response: {raw[:600]}")
    return data


# ── Mill cert extraction ──────────────────────────────────────────────────────

_CERT_PROMPT = """You are a quality assurance engineer reading a material test certificate.
This may be multi-page. Focus on pages with quantitative test data AND compliance statements.
Translate all parameter names to English.

IMPORTANT JSON RULES:
- Return ONLY valid JSON — no markdown fences, no text before or after
- Start your response directly with {
- All string values must use double quotes
- No trailing commas

{
  "vendor": "manufacturer / mill name",
  "heat_number": "heat / cast / lot / VAR number",
  "material": "material designation and grade (e.g. UNS N09925, 316L)",
  "certificate_number": "cert / document number",
  "order_number": "customer PO or order reference if present",
  "standard": "applicable standard(s) if stated",
  "product_form": "round bar / plate / pipe / sheet / etc.",
  "dimensions": "size / diameter if stated",
  "heat_treatment": "full heat treatment condition as stated on cert",
  "steelmaking_process": "e.g. EAF + AOD + VAR remelting",
  "welding": "e.g. No welding performed",
  "country_of_origin": "country",
  "parameters": [
    {
      "name": "parameter name in English",
      "symbol": "element symbol or abbreviation",
      "category": "chemical | mechanical | dimensional | surface | compliance | other",
      "value": "reported value exactly as shown",
      "numeric_value": number_or_null,
      "unit": "%, MPa, HRC, HBW, J, mm, etc."
    }
  ],
  "compliance_statements": [
    "list every compliance or conformance statement found on the cert as separate strings",
    "e.g. Material free from Mercury contamination",
    "e.g. No welding performed on material",
    "e.g. Tested per ASTM E8"
  ],
  "remarks": "any other notes or inspection results"
}

STRICT RULES:
1. Each chemical element = separate entry. Never combine elements.
2. For values like <0.0004 set numeric_value to 0.0004.
3. Hardness: include ALL hardness results from ALL pages.
4. Impact: include individual values AND average.
5. SKIP micrograph images, heat treatment charts, furnace graphs, index pages.
6. Do NOT skip any numeric value from test data pages.
7. SAME CERT UPLOADED MULTIPLE TIMES = SAME RESULT (be deterministic).
8. Capture ALL text statements — heat treatment, process, NDE results, compliance declarations."""


def extract_mill_cert(file_path: str) -> dict:
    """
    Extract all test data from a mill certificate (any language).
    Always uses Claude Vision — mill certs have complex multi-column tables.
    Never skips pages — skip_sparse=False ensures no data pages are missed.
    """
    images = _pdf_to_images(file_path, MAX_PAGES_CERT, skip_sparse=False)
    if not images:
        raise ValueError("Could not extract any readable pages from the mill certificate.")

    content = _image_content(images)
    content.append({"type": "text", "text": _CERT_PROMPT})

    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        temperature=0,
        messages=[{"role": "user", "content": content}],
    )

    raw = resp.content[0].text.strip()
    data = _parse_json(raw)
    if not data:
        raise ValueError(f"Could not parse mill certificate. Response: {raw[:600]}")
    return data