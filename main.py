import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from database import create_tables
from config import UPLOAD_DIR, SPECS_DIR, CERTS_DIR
from routers import specs, reviews, dashboard

app = FastAPI(title="Material Review Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(specs.router, prefix="/api/specs", tags=["Specifications"])
app.include_router(reviews.router, prefix="/api/reviews", tags=["Reviews"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


@app.on_event("startup")
async def startup():
    create_tables()
    _migrate_db()
    _cleanup_uploads()
    for d in [UPLOAD_DIR, SPECS_DIR, CERTS_DIR]:
        os.makedirs(d, exist_ok=True)
    print("[OK] Material Review Agent running at http://localhost:8000")


def _cleanup_uploads():
    """Remove any spec PDFs left over from before the no-storage policy."""
    import glob as _glob
    from config import SPECS_DIR, CERTS_DIR
    for folder in [SPECS_DIR, CERTS_DIR]:
        for f in _glob.glob(os.path.join(folder, "*")):
            try:
                os.remove(f)
            except Exception:
                pass


def _migrate_db():
    """Add any new columns to existing tables without losing data."""
    from database import engine
    new_cols = [
        ("reviews",  "reviewer_decision", "VARCHAR"),
        ("reviews",  "reviewer_comment",  "TEXT"),
        ("reviews",  "reviewer_at",       "DATETIME"),
    ]
    with engine.connect() as conn:
        for table, col, col_type in new_cols:
            try:
                conn.execute(__import__("sqlalchemy").text(
                    f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"
                ))
                conn.commit()
            except Exception:
                pass  # column already exists — ignore
