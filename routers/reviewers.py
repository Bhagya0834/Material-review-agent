import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Reviewer

router = APIRouter()


class ReviewerCreate(BaseModel):
    name: str


@router.get("/")
def list_reviewers(db: Session = Depends(get_db)):
    rows = db.query(Reviewer).order_by(Reviewer.name).all()
    return [{"id": r.id, "name": r.name} for r in rows]


@router.post("/")
def create_reviewer(payload: ReviewerCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Reviewer name cannot be empty")
    existing = db.query(Reviewer).filter(Reviewer.name == name).first()
    if existing:
        return {"id": existing.id, "name": existing.name}
    r = Reviewer(name=name)
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id, "name": r.name}
