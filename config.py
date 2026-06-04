from dotenv import load_dotenv
import os

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
DATABASE_URL = "sqlite:///./material_review.db"
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
SPECS_DIR = os.path.join(UPLOAD_DIR, "specs")
CERTS_DIR = os.path.join(UPLOAD_DIR, "mill_certs")

MAX_PAGES_SPEC = 40   # specifications can be multi-section documents
MAX_PAGES_CERT = 10   # mill certs: 1-10 pages as stated
MAX_PAGES = MAX_PAGES_SPEC   # default (overridden per call)
OCR_DPI = 200
PASS_THRESHOLD = 90.0
