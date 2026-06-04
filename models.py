from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, Text, Boolean
from sqlalchemy.sql import func
from database import Base


class CustomParameter(Base):
    """User-defined parameters added to a spec — checked on every review."""
    __tablename__ = "custom_parameters"

    id              = Column(Integer, primary_key=True, index=True)
    spec_id         = Column(Integer, nullable=False, index=True)
    name            = Column(String, nullable=False)
    symbol          = Column(String, default="")
    category        = Column(String, default="other")   # chemical|mechanical|dimensional|surface|compliance|other
    min_value       = Column(Float, nullable=True)
    max_value       = Column(Float, nullable=True)
    nominal_value   = Column(Float, nullable=True)
    unit            = Column(String, default="")
    requirement_text= Column(Text, default="")          # for non-numeric requirements
    is_critical     = Column(Boolean, default=True)
    created_at      = Column(DateTime, server_default=func.now())


class CertCache(Base):
    """Stores mill cert extraction results keyed by file SHA256 hash.
    Same file uploaded again → reuse stored data → identical score every time."""
    __tablename__ = "cert_cache"

    id = Column(Integer, primary_key=True, index=True)
    file_hash = Column(String, unique=True, nullable=False, index=True)
    extracted_data = Column(JSON, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class Specification(Base):
    __tablename__ = "specifications"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    material_type = Column(String, default="")
    standard = Column(String, default="")
    grade = Column(String, default="")
    description = Column(Text, default="")
    file_path = Column(String, default="")
    original_filename = Column(String, default="")
    extracted_params = Column(JSON, nullable=True)   # Stored once, reused forever
    raw_text = Column(Text, default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    spec_id = Column(Integer, nullable=False)
    spec_name = Column(String, default="")
    vendor = Column(String, default="")
    heat_number = Column(String, default="")
    material = Column(String, default="")
    po_number = Column(String, default="")
    cert_filename = Column(String, default="")
    cert_file_path = Column(String, default="")
    cert_raw_text = Column(Text, default="")
    cert_extracted = Column(JSON, nullable=True)
    status = Column(String, default="PROCESSING")   # PROCESSING | APPROVED | UNDER_REVIEW | REJECTED | ERROR
    score = Column(Float, nullable=True)
    total_parameters = Column(Integer, nullable=True)
    passed = Column(Integer, nullable=True)
    failed = Column(Integer, nullable=True)
    not_found = Column(Integer, nullable=True)
    comparison_result = Column(JSON, nullable=True)
    error_message = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())
    reviewed_at = Column(DateTime, nullable=True)
    reviewer_decision = Column(String, nullable=True)   # Manual override: APPROVED | UNDER_REVIEW | REJECTED
    reviewer_comment  = Column(Text, nullable=True)     # Reviewer's reason / notes
    reviewer_at       = Column(DateTime, nullable=True)
