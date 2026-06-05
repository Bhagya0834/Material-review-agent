import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from collections import defaultdict

from database import get_db
from models import Review, Specification

router = APIRouter()


def _parse_month(s):
    return datetime.strptime(s, "%b %Y")


def _monthly_trends(field, recent, all_months, top_n=5):
    """Return [{label, data: [count_per_month]}] for the top N entities."""
    totals = defaultdict(int)
    for r in recent:
        val = getattr(r, field, None)
        if val:
            totals[val] += 1
    top = [e for e, _ in sorted(totals.items(), key=lambda x: x[1], reverse=True)[:top_n]]

    by_entity = defaultdict(lambda: defaultdict(int))
    for r in recent:
        val = getattr(r, field, None)
        if val and r.created_at:
            by_entity[val][r.created_at.strftime("%b %Y")] += 1

    return [
        {"label": entity, "data": [by_entity[entity].get(m, 0) for m in all_months]}
        for entity in top
    ]


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

    # Monthly totals for existing bar chart
    monthly: dict = defaultdict(lambda: {"APPROVED": 0, "UNDER_REVIEW": 0, "REJECTED": 0})
    for r in recent:
        if r.created_at:
            monthly[r.created_at.strftime("%b %Y")][r.status] += 1

    # Sorted month labels (chronological, last 6)
    trend_months = sorted(
        {r.created_at.strftime("%b %Y") for r in recent if r.created_at},
        key=_parse_month
    )[-6:]

    last5 = db.query(Review).order_by(Review.created_at.desc()).limit(5).all()

    return {
        "total_reviews":   total,
        "approved":        approved,
        "under_review":    under_review,
        "rejected":        rejected,
        "processing":      processing,
        "avg_score":       round(avg_score, 1) if avg_score else None,
        "spec_count":      spec_count,
        "pass_rate":       round(approved / (approved + under_review + rejected) * 100, 1)
                           if (approved + under_review + rejected) > 0 else None,
        "monthly":         dict(monthly),
        "trend_months":    trend_months,
        "vendor_trends":   _monthly_trends("vendor",        recent, trend_months),
        "material_trends": _monthly_trends("material",      recent, trend_months),
        "spec_trends":     _monthly_trends("spec_name",     recent, trend_months),
        "reviewer_trends": _monthly_trends("reviewer_name", recent, trend_months),
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
