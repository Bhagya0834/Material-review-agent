import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from collections import defaultdict

from database import get_db
from models import Review, Specification

router = APIRouter()


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    total        = db.query(func.count(Review.id)).scalar() or 0
    approved     = db.query(func.count(Review.id)).filter(Review.status == "APPROVED").scalar() or 0
    under_review = db.query(func.count(Review.id)).filter(Review.status == "UNDER_REVIEW").scalar() or 0
    rejected     = db.query(func.count(Review.id)).filter(Review.status == "REJECTED").scalar() or 0
    processing   = db.query(func.count(Review.id)).filter(Review.status == "PROCESSING").scalar() or 0

    avg_score  = db.query(func.avg(Review.score)).filter(Review.score != None).scalar()
    spec_count = db.query(func.count(Specification.id)).filter(Specification.is_active == True).scalar() or 0

    recent = (
        db.query(Review)
        .filter(Review.status.in_(["APPROVED", "UNDER_REVIEW", "REJECTED"]))
        .order_by(Review.created_at.desc())
        .limit(200)
        .all()
    )

    # Monthly breakdown (last 6 months)
    monthly: dict = defaultdict(lambda: {"APPROVED": 0, "UNDER_REVIEW": 0, "REJECTED": 0})
    for r in recent:
        if r.created_at:
            key = r.created_at.strftime("%b %Y")
            monthly[key][r.status] += 1

    def _status_breakdown(field, top_n=5):
        counts: dict = defaultdict(lambda: {"APPROVED": 0, "UNDER_REVIEW": 0, "REJECTED": 0})
        for r in recent:
            val = getattr(r, field, None)
            if val:
                counts[val][r.status] += 1
        top = sorted(counts.items(), key=lambda x: sum(x[1].values()), reverse=True)[:top_n]
        return [
            {
                "label":       label,
                "approved":    c["APPROVED"],
                "under_review":c["UNDER_REVIEW"],
                "rejected":    c["REJECTED"],
            }
            for label, c in top
        ]

    last5 = db.query(Review).order_by(Review.created_at.desc()).limit(5).all()

    return {
        "total_reviews": total,
        "approved":      approved,
        "under_review":  under_review,
        "rejected":      rejected,
        "processing":    processing,
        "avg_score":     round(avg_score, 1) if avg_score else None,
        "spec_count":    spec_count,
        "pass_rate":     round(approved / (approved + under_review + rejected) * 100, 1)
                         if (approved + under_review + rejected) > 0 else None,
        "monthly":       dict(monthly),
        "top_vendors":   _status_breakdown("vendor"),
        "top_materials": _status_breakdown("material"),
        "top_specs":     _status_breakdown("spec_name"),
        "recent_reviews": [
            {
                "id":         r.id,
                "vendor":     r.vendor,
                "material":   r.material,
                "spec_name":  r.spec_name,
                "status":     r.status,
                "score":      r.score,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in last5
        ],
    }
