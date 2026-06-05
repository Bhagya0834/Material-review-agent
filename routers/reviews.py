import hashlib
import os
import shutil
import sys
import threading
import tempfile
from datetime import datetime, timezone

def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import Review, Specification, CertCache, CustomParameter
from services.document_processor import extract_mill_cert
from services.comparison_service import compare

router = APIRouter()


def _file_hash(path: str) -> str:
    """SHA256 hash of a file — used to detect identical uploads."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _get_cached_cert(db, file_hash: str):
    """Return cached extraction if this exact file was processed before, else None."""
    try:
        row = db.query(CertCache).filter(CertCache.file_hash == file_hash).first()
        return row.extracted_data if row else None
    except Exception:
        return None


def _save_cert_cache(db, file_hash: str, data: dict):
    """Save extraction result to cache — silently ignore any DB error."""
    try:
        existing = db.query(CertCache).filter(CertCache.file_hash == file_hash).first()
        if not existing:
            db.add(CertCache(file_hash=file_hash, extracted_data=data))
            db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _run_review(review_id: int):
    """Background task: OCR + compare + store result."""
    db = SessionLocal()
    review = None
    try:
        review = db.query(Review).filter(Review.id == review_id).first()
        spec = db.query(Specification).filter(Specification.id == review.spec_id).first()

        if not spec or not spec.extracted_params:
            review.status = "ERROR"
            review.error_message = "Specification data not found."
            db.commit()
            return

        # Merge user-defined custom parameters into spec data before comparison
        spec_data = dict(spec.extracted_params)
        custom_params = db.query(CustomParameter).filter(CustomParameter.spec_id == spec.id).all()
        if custom_params:
            existing = list(spec_data.get("parameters", []))
            for cp in custom_params:
                existing.append({
                    "name": cp.name,
                    "symbol": cp.symbol or "",
                    "category": cp.category or "other",
                    "min_value": cp.min_value,
                    "max_value": cp.max_value,
                    "nominal_value": cp.nominal_value,
                    "unit": cp.unit or "",
                    "requirement_text": cp.requirement_text or "",
                    "is_critical": cp.is_critical,
                    "notes": "User-defined custom parameter",
                })
            spec_data["parameters"] = existing

        # Step 1 – extract mill cert (use cache if same file seen before)
        cert_hash = _file_hash(review.cert_file_path)
        cert_data = _get_cached_cert(db, cert_hash)
        if cert_data is None:
            cert_data = extract_mill_cert(review.cert_file_path)
            _save_cert_cache(db, cert_hash, cert_data)

        # Step 2 – compare (spec_data includes any user-defined custom parameters)
        result = compare(spec_data, cert_data)

        # Step 3 – persist
        review.vendor = cert_data.get("vendor", "")
        review.heat_number = cert_data.get("heat_number", "")
        review.material = cert_data.get("material", "")
        review.cert_extracted = cert_data
        review.status = result.get("overall_status", "UNDER_REVIEW")
        review.score = result.get("compliance_score", 0.0)
        review.total_parameters = result.get("total_parameters", 0)
        review.passed = result.get("passed", 0)
        review.failed = result.get("failed", 0)
        review.not_found = result.get("not_found", 0)
        review.comparison_result = result
        review.reviewed_at = _now()
        db.commit()

    except Exception as e:
        db = SessionLocal()
        rev = db.query(Review).filter(Review.id == review_id).first()
        if rev:
            rev.status = "ERROR"
            rev.error_message = str(e)[:1000]
            db.commit()
        db.close()
    finally:
        db.close()
        # Delete temp cert file after review — no permanent storage
        try:
            if review and os.path.exists(review.cert_file_path):
                os.remove(review.cert_file_path)
        except Exception:
            pass


@router.post("/start")
async def start_review(
    file: UploadFile = File(...),
    spec_id: int = Form(...),
    po_number: str = Form(""),
    reviewer_name: str = Form(""),
    db: Session = Depends(get_db),
):
    spec = db.query(Specification).filter(Specification.id == spec_id, Specification.is_active == True).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")

    # Save to temp file instead of uploads folder — gets deleted after review
    suffix = os.path.splitext(file.filename)[1]
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    shutil.copyfileobj(file.file, tmp)
    tmp.close()
    dest = tmp.name

    review = Review(
        spec_id=spec_id,
        spec_name=spec.name,
        po_number=po_number,
        reviewer_name=reviewer_name.strip() or None,
        cert_filename=file.filename,
        cert_file_path=dest,
        status="PROCESSING",
    )
    db.add(review)
    db.commit()
    db.refresh(review)

    # Fire background thread so the HTTP response returns immediately
    t = threading.Thread(target=_run_review, args=(review.id,), daemon=True)
    t.start()

    return {"review_id": review.id, "status": "PROCESSING"}


@router.get("/")
def list_reviews(skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    reviews = (
        db.query(Review)
        .order_by(Review.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_review_summary(r) for r in reviews]


@router.get("/{review_id}")
def get_review(review_id: int, db: Session = Depends(get_db)):
    r = db.query(Review).filter(Review.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    return {
        **_review_summary(r),
        "cert_extracted": r.cert_extracted,
        "comparison_result": r.comparison_result,
        "error_message": r.error_message,
    }


@router.patch("/{review_id}/override")
def override_review(review_id: int, payload: dict, db: Session = Depends(get_db)):
    """Reviewer manually overrides the system decision."""
    try:
        r = db.query(Review).filter(Review.id == review_id).first()
        if not r:
            raise HTTPException(status_code=404, detail="Review not found")
        decision = payload.get("decision", "").upper()
        if decision not in ("APPROVED", "UNDER_REVIEW", "REJECTED"):
            raise HTTPException(status_code=400, detail="Decision must be APPROVED, UNDER_REVIEW or REJECTED")
        r.reviewer_decision = decision
        r.reviewer_comment  = payload.get("comment", "").strip()
        r.reviewer_at       = _now()
        db.commit()
        return {"message": "Override saved.", "reviewer_decision": decision}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save override: {e}")


def _review_summary(r: Review) -> dict:
    return {
        "id": r.id,
        "spec_id": r.spec_id,
        "spec_name": r.spec_name,
        "vendor": r.vendor,
        "heat_number": r.heat_number,
        "material": r.material,
        "po_number": r.po_number,
        "cert_filename": r.cert_filename,
        "status": r.status,
        "score": r.score,
        "total_parameters": r.total_parameters,
        "passed": r.passed,
        "failed": r.failed,
        "not_found": r.not_found,
        "reviewer_name":     r.reviewer_name,
        "reviewer_decision": r.reviewer_decision,
        "reviewer_comment":  r.reviewer_comment,
        "reviewer_at":       r.reviewer_at.isoformat() if r.reviewer_at else None,
        "created_at":        r.created_at.isoformat() if r.created_at else None,
        "reviewed_at":       r.reviewed_at.isoformat() if r.reviewed_at else None,
    }