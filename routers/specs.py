import os
import shutil
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Specification, CustomParameter
from config import SPECS_DIR
from services.document_processor import extract_spec_params

router = APIRouter()


def _safe_delete(path: str):
    """Delete a file silently — no crash if missing or unreadable."""
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


@router.get("/")
def list_specs(db: Session = Depends(get_db)):
    specs = db.query(Specification).filter(Specification.is_active == True).order_by(Specification.created_at.desc()).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "material_type": s.material_type,
            "standard": s.standard,
            "grade": s.grade,
            "description": s.description,
            "original_filename": s.original_filename,
            "param_count": len(s.extracted_params.get("parameters", [])) if s.extracted_params else 0,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in specs
    ]


@router.get("/{spec_id}")
def get_spec(spec_id: int, db: Session = Depends(get_db)):
    spec = db.query(Specification).filter(Specification.id == spec_id).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    return {
        "id": spec.id,
        "name": spec.name,
        "material_type": spec.material_type,
        "standard": spec.standard,
        "grade": spec.grade,
        "description": spec.description,
        "original_filename": spec.original_filename,
        "extracted_params": spec.extracted_params,
        "created_at": spec.created_at.isoformat() if spec.created_at else None,
    }


@router.post("/upload")
async def upload_spec(
    file: UploadFile = File(...),
    name: str = Form(...),
    material_type: str = Form(""),
    standard: str = Form(""),
    grade: str = Form(""),
    description: str = Form(""),
    db: Session = Depends(get_db),
):
    os.makedirs(SPECS_DIR, exist_ok=True)

    safe_name = "".join(c for c in name if c.isalnum() or c in " _-").strip().replace(" ", "_")
    dest = os.path.join(SPECS_DIR, f"{safe_name}_{file.filename}")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        params = extract_spec_params(dest, name)
    except Exception as e:
        _safe_delete(dest)
        raise HTTPException(status_code=422, detail=f"Failed to extract spec parameters: {e}")
    finally:
        _safe_delete(dest)   # PDF no longer needed — parameters are in DB

    spec = Specification(
        name=name,
        material_type=material_type or params.get("material_name", ""),
        standard=standard or params.get("standard", ""),
        grade=grade or params.get("grade", ""),
        description=description,
        file_path="",        # not stored; was deleted above
        original_filename=file.filename,
        extracted_params=params,
        raw_text="",
    )
    db.add(spec)
    db.commit()
    db.refresh(spec)

    return {
        "id": spec.id,
        "name": spec.name,
        "param_count": len(params.get("parameters", [])),
        "message": "Specification uploaded and processed successfully.",
    }


@router.post("/{spec_id}/reupload")
async def reupload_spec(
    spec_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Replace the PDF and re-extract parameters for an existing specification.
    Custom parameters and all other spec metadata are preserved."""
    spec = db.query(Specification).filter(Specification.id == spec_id, Specification.is_active == True).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")

    os.makedirs(SPECS_DIR, exist_ok=True)
    safe_name = "".join(c for c in spec.name if c.isalnum() or c in " _-").strip().replace(" ", "_")
    dest = os.path.join(SPECS_DIR, f"{safe_name}_rev_{file.filename}")

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        params = extract_spec_params(dest, spec.name)
    except Exception as e:
        _safe_delete(dest)
        raise HTTPException(status_code=422, detail=f"Failed to extract parameters from new PDF: {e}")
    finally:
        _safe_delete(dest)   # delete new PDF — params now in DB
        _safe_delete(spec.file_path)  # delete old PDF if it existed

    spec.file_path        = ""
    spec.original_filename= file.filename
    spec.extracted_params = params
    # Update material/standard/grade if Claude found better values
    if not spec.material_type and params.get("material_name"):
        spec.material_type = params["material_name"]
    if not spec.standard and params.get("standard"):
        spec.standard = params["standard"]
    if not spec.grade and params.get("grade"):
        spec.grade = params["grade"]

    db.commit()
    return {
        "id": spec.id,
        "name": spec.name,
        "param_count": len(params.get("parameters", [])),
        "message": "Specification re-uploaded and parameters updated successfully.",
    }


@router.delete("/{spec_id}")
def delete_spec(spec_id: int, db: Session = Depends(get_db)):
    spec = db.query(Specification).filter(Specification.id == spec_id).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    _safe_delete(spec.file_path)   # remove PDF if still on disk
    spec.is_active = False
    db.commit()
    return {"message": "Specification deleted."}


# ── Custom Parameters ─────────────────────────────────────────────────────────

@router.get("/{spec_id}/custom-params")
def list_custom_params(spec_id: int, db: Session = Depends(get_db)):
    rows = db.query(CustomParameter).filter(CustomParameter.spec_id == spec_id).order_by(CustomParameter.created_at).all()
    return [_cp_dict(r) for r in rows]


@router.post("/{spec_id}/custom-params")
def add_custom_param(spec_id: int, payload: dict, db: Session = Depends(get_db)):
    spec = db.query(Specification).filter(Specification.id == spec_id, Specification.is_active == True).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Parameter name is required")
    try:
        cp = CustomParameter(
            spec_id       = spec_id,
            name          = name,
            symbol        = (payload.get("symbol") or "").strip(),
            category      = (payload.get("category") or "other").strip(),
            min_value     = payload.get("min_value"),
            max_value     = payload.get("max_value"),
            nominal_value = payload.get("nominal_value"),
            unit          = (payload.get("unit") or "").strip(),
            requirement_text = (payload.get("requirement_text") or "").strip(),
            is_critical   = bool(payload.get("is_critical", True)),
        )
        db.add(cp)
        db.commit()
        db.refresh(cp)
        return _cp_dict(cp)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save parameter: {e}")


@router.patch("/{spec_id}/custom-params/{param_id}")
def edit_custom_param(spec_id: int, param_id: int, payload: dict, db: Session = Depends(get_db)):
    cp = db.query(CustomParameter).filter(CustomParameter.id == param_id, CustomParameter.spec_id == spec_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Custom parameter not found")
    try:
        if "name"             in payload: cp.name             = str(payload["name"]).strip()
        if "symbol"           in payload: cp.symbol           = str(payload.get("symbol","")).strip()
        if "category"         in payload: cp.category         = str(payload["category"]).strip()
        if "min_value"        in payload: cp.min_value        = payload["min_value"]
        if "max_value"        in payload: cp.max_value        = payload["max_value"]
        if "nominal_value"    in payload: cp.nominal_value    = payload["nominal_value"]
        if "unit"             in payload: cp.unit             = str(payload.get("unit","")).strip()
        if "requirement_text" in payload: cp.requirement_text = str(payload.get("requirement_text","")).strip()
        if "is_critical"      in payload: cp.is_critical      = bool(payload["is_critical"])
        db.commit()
        db.refresh(cp)
        return _cp_dict(cp)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{spec_id}/custom-params/{param_id}")
def delete_custom_param(spec_id: int, param_id: int, db: Session = Depends(get_db)):
    cp = db.query(CustomParameter).filter(CustomParameter.id == param_id, CustomParameter.spec_id == spec_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Custom parameter not found")
    try:
        db.delete(cp)
        db.commit()
        return {"message": "Deleted."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{spec_id}/extracted-param/{param_index}")
def delete_extracted_param(spec_id: int, param_index: int, db: Session = Depends(get_db)):
    """Remove a parameter by index from the extracted_params list."""
    spec = db.query(Specification).filter(Specification.id == spec_id, Specification.is_active == True).first()
    if not spec or not spec.extracted_params:
        raise HTTPException(status_code=404, detail="Specification not found")
    try:
        params = list(spec.extracted_params.get("parameters", []))
        if param_index < 0 or param_index >= len(params):
            raise HTTPException(status_code=400, detail="Invalid parameter index")
        removed = params.pop(param_index)
        updated = dict(spec.extracted_params)
        updated["parameters"] = params
        spec.extracted_params = updated
        db.commit()
        return {"message": f"Parameter '{removed.get('name','?')}' removed.", "remaining": len(params)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{spec_id}/edit-extracted-param")
def edit_extracted_param(spec_id: int, payload: dict, db: Session = Depends(get_db)):
    """Edit min/max/unit of an extracted parameter by index."""
    spec = db.query(Specification).filter(Specification.id == spec_id, Specification.is_active == True).first()
    if not spec or not spec.extracted_params:
        raise HTTPException(status_code=404, detail="Specification not found")
    try:
        idx = int(payload.get("index", -1))
        params = list(spec.extracted_params.get("parameters", []))
        if idx < 0 or idx >= len(params):
            raise HTTPException(status_code=400, detail="Invalid parameter index")
        p = dict(params[idx])
        for field in ("min_value","max_value","nominal_value","unit","requirement_text","is_critical","name","symbol"):
            if field in payload:
                p[field] = payload[field]
        params[idx] = p
        updated = dict(spec.extracted_params)
        updated["parameters"] = params
        spec.extracted_params = updated
        db.commit()
        return {"message": "Updated.", "parameter": p}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


def _cp_dict(cp: CustomParameter) -> dict:
    return {
        "id": cp.id, "spec_id": cp.spec_id, "name": cp.name, "symbol": cp.symbol,
        "category": cp.category, "min_value": cp.min_value, "max_value": cp.max_value,
        "nominal_value": cp.nominal_value, "unit": cp.unit,
        "requirement_text": cp.requirement_text, "is_critical": cp.is_critical,
        "created_at": cp.created_at.isoformat() if cp.created_at else None,
    }
