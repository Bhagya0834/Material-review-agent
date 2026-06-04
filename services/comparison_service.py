"""
Comparison engine: spec parameters vs mill certificate data.
Uses Claude for intelligent parameter matching, unit conversion,
and pass/fail determination. Produces a deterministic JSON result.
"""

import json
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import anthropic
from config import ANTHROPIC_API_KEY, PASS_THRESHOLD

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def _parse_json(text: str) -> dict:
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


COMPARISON_PROMPT = """You are a senior quality engineer performing a formal material compliance review.

== SPECIFICATION REQUIREMENTS ==
__SPEC_JSON__

== MILL CERTIFICATE DATA ==
__CERT_JSON__

Instructions:

THERE ARE TWO TYPES OF REQUIREMENTS — treat both with equal importance:

TYPE 1 — NUMERIC REQUIREMENTS (e.g. Carbon max 0.30%, Yield Strength min 820 MPa):
- Find the matching reported value in the mill certificate
- Match by meaning not just name (e.g. "Carbon" matches "C", "碳")
- Convert units when necessary (MPa ↔ N/mm², ksi ↔ MPa, HB = HBW, etc.)
- PASS: reported value is within the specified limits (inclusive)
- FAIL: reported value is outside the specified limits
- NOT_FOUND: mandatory numeric parameter completely absent from cert

TYPE 2 — TEXT / STATEMENT REQUIREMENTS (e.g. heat treatment condition, delivery condition,
NDE method, steelmaking process, compliance declarations, test standards, surface condition):
- These are just as mandatory as numeric requirements
- CONFIRMED: the requirement is clearly stated on the cert and matches
- NOT_COMPLIANT: the cert contradicts the requirement
- NOT_STATED: the requirement is not mentioned on the cert at all (advisory, not a failure)
- Examples:
    * Spec says "Solution annealed + age hardened" → cert states same → CONFIRMED
    * Spec says "No welding permitted" → cert says "welding performed" → NOT_COMPLIANT
    * Spec says "VAR remelting required" → cert confirms VAR → CONFIRMED
    * Spec says "Tested per ASTM E8" → cert does not mention test standard → NOT_STATED
    * Spec says "Free from continuous networks of secondary phases" → cert confirms micrographic result → CONFIRMED

DECISION RULES:
- "APPROVED"     : all numeric = PASS AND all hard text = CONFIRMED (NOT_STATED is advisory only)
- "REJECTED"     : ANY numeric = FAIL OR any text = NOT_COMPLIANT OR mandatory numeric = NOT_FOUND
- "UNDER_REVIEW" : no failures but some text requirements are NOT_STATED

CONFIDENCE SCORING — be realistic and honest:
- 85-95%: Clean digital PDF, all values clearly readable, no ambiguity
- 65-80%: Scanned but mostly readable, minor uncertainty on 1-2 values
- 45-65%: Poor scan, some values unclear but key parameters readable
- 25-44%: Very poor quality, many values unclear
- Do NOT lower confidence just because document is in another language
- Do NOT lower confidence just because document is scanned — judge actual readability

CRITICAL FAILURE definition: is_critical=true AND (status=FAIL OR status=NOT_COMPLIANT)

Return ONLY valid JSON — no markdown fences, no explanation:
{
  "vendor": "string",
  "heat_number": "string",
  "material": "string",
  "certificate_number": "string",
  "overall_status": "APPROVED | UNDER_REVIEW | REJECTED",
  "compliance_score": 0.0,
  "total_parameters": 0,
  "passed": 0,
  "failed": 0,
  "not_found": 0,
  "critical_failures": ["list of parameter names that are critical failures"],
  "parameters": [
    {
      "name": "spec parameter name",
      "symbol": "symbol if applicable",
      "category": "chemical | mechanical | dimensional | surface | compliance | other",
      "parameter_type": "numeric | text",
      "is_critical": true,
      "spec_min": null,
      "spec_max": null,
      "spec_nominal": null,
      "spec_unit": "string",
      "spec_requirement_text": "full text of requirement if text type",
      "actual_value": "string as reported",
      "actual_numeric": null,
      "actual_unit": "string",
      "actual_text": "exact statement found on cert if text type",
      "status": "PASS",
      "notes": "brief reason if FAIL or unit conversion note"
    }
  ],
  "summary": "2-3 sentence narrative of the overall compliance result",
  "decision_reason": "one sentence explaining the status decision"
}
"""


def compare(spec_params: dict, cert_data: dict) -> dict:
    """
    Core comparison function. Returns a structured compliance result dict.
    """
    prompt = (
        COMPARISON_PROMPT
        .replace("__SPEC_JSON__", json.dumps(spec_params, indent=2))
        .replace("__CERT_JSON__", json.dumps(cert_data, indent=2))
        .replace("__THRESHOLD__", str(PASS_THRESHOLD))
    )

    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        temperature=0,
        system=(
            "You are a deterministic quality-review engine. "
            "Always return valid JSON. Never guess; if a value is absent mark it NOT_FOUND."
        ),
        messages=[{"role": "user", "content": prompt}],
    )

    raw = resp.content[0].text
    if not raw.rstrip().endswith("}"):
        # Attempt truncation repair before parse
        last = raw.rfind("},")
        if last != -1:
            raw = raw[:last + 1].rstrip(",") + '\n  ]\n}'
    result = _parse_json(raw)

    if not result:
        raise ValueError(f"Comparison returned unparseable response: {raw[:600]}")

    # Recalculate score and status in Python — consistent regardless of Claude output
    params     = result.get("parameters", [])
    total      = len(params)
    passed     = sum(1 for p in params if p.get("status") in ("PASS", "CONFIRMED"))
    failed     = sum(1 for p in params if p.get("status") in ("FAIL", "NOT_COMPLIANT"))
    not_found  = sum(1 for p in params if p.get("status") == "NOT_FOUND")
    not_stated = sum(1 for p in params if p.get("status") == "NOT_STATED")

    # Score = PASS / (PASS + FAIL + NOT_FOUND) only
    # NOT_STATED text requirements are advisory — they do NOT reduce the compliance score
    measurable = passed + failed + not_found
    score = round((passed / measurable * 100) if measurable > 0 else 0.0, 1)

    critical_failures = [
        p["name"] for p in params
        if p.get("is_critical") and p.get("status") in ("FAIL", "NOT_COMPLIANT")
    ]
    critical_not_found = [
        p["name"] for p in params
        if p.get("is_critical") and p.get("status") == "NOT_FOUND"
    ]

    # Decision rules (threshold 90%):
    # APPROVED     — score >= 90% AND zero failures
    # UNDER_REVIEW — score >= 90% AND some failures present (human must review)
    # REJECTED     — score < 90%
    if score < PASS_THRESHOLD:
        overall_status = "REJECTED"
    elif failed > 0 or critical_not_found:
        overall_status = "UNDER_REVIEW"
    else:
        overall_status = "APPROVED"

    result.update({
        "overall_status": overall_status,
        "compliance_score": score,
        "total_parameters": total,
        "passed": passed,
        "failed": failed,
        "not_found": not_found,
        "not_stated": not_stated,
        "critical_failures": critical_failures,
    })

    return result
