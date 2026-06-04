# Material Review Agent

A fast, accurate web application for reviewing mill certificates against organizational material specifications using OCR and intelligent compliance checking.

## 🎯 Features

- **Dashboard**: Real-time statistics on reviews (Approved, Under Review, Failed)
- **Specs Library**: Upload and store organizational material specifications once, reuse forever
- **New Review**: Compare mill certificates against stored specs with automatic OCR extraction
- **Review History**: Track all reviews with decisions and compliance details
- **Multi-language OCR**: Supports English and Chinese certificate text extraction
- **Fast Processing**: Extract specs once, reuse for unlimited reviews
- **Smart Decision Logic**: 
  - **Approved**: ≥90% parameter match + no critical failures
  - **Under Review**: 70-89% match or minor failures
  - **Fail**: <70% match or critical spec violation

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- Windows/Mac/Linux

### Installation

1. Clone the repository:

```bash
git clone https://github.com/Bhagya0834/material-review-agent.git
cd material-review-agent
```

2. Install dependencies:

```powershell
python -m pip install -r requirements.txt
```

3. Run the app:

```powershell
python main.py
```

Or double-click `start.bat` (Windows)

4. Open in your browser:

```
http://localhost:8000/
```

## 📋 How It Works

### Step 1: Create Specs Library

1. Go to **Specs Library** → **Upload New Spec**
2. Upload your material specification (PDF, DOCX, TXT, PNG, JPG)
3. The system extracts all compliance parameters automatically
4. Data is stored in the database for fast reuse

### Step 2: Review Mill Certificates

1. Go to **New Review**
2. Select a saved specification
3. Upload the mill certificate (same formats)
4. System automatically:
   - Extracts text using OCR
   - Compares parameters against stored spec
   - Generates compliance summary
   - Decides: Approve / Under Review / Fail

### Step 3: Track Results

- **Dashboard**: See statistics at a glance
- **Review History**: View all past reviews with detailed results

## 📁 Project Structure

```
material-review-agent/
├── main.py              # Entry point
├── config.py            # Configuration settings
├── database.py          # Database initialization & queries
├── models.py            # Data models
├── app.py               # Flask app (legacy)
├── requirements.txt     # Python dependencies
├── start.bat            # Windows batch starter
├── routers/             # API endpoints
├── services/            # Business logic (OCR, comparison, etc.)
├── templates/           # HTML pages
├── static/              # CSS, JS, images
└── uploads/             # User uploads (ignored in git)
```

## 🔧 Configuration

Edit `config.py` to customize:

- Port number
- Upload folder location
- Database path
- OCR languages
- Passing criteria threshold

## 🗄️ Database

The app uses SQLite (`material_review.db`) to store:

- Uploaded specifications (with extracted parameters)
- Review results (comparisons, decisions, scores)

Database is created automatically on first run.

## 📤 Supported File Formats

**For Specifications & Mill Certificates:**
- PDF
- DOCX
- TXT
- PNG, JPG, JPEG
- Recommended: **1-10 pages** for best performance

**Note**: Images, index pages, and non-compliance sections are automatically skipped.

## ✅ Compliance Criteria

| Score      | Decision      | Details                              |
|-----------|---------------|--------------------------------------|
| ≥ 90%     | **Approved**  | All critical specs matched           |
| 70-89%    | **Under Review** | Review required, minor gaps found    |
| < 70%     | **Fail**      | Critical failures or too many misses |

## 🌍 Multi-language Support

- English
- Simplified Chinese
- Traditional Chinese

Add more languages in `config.py` using [EasyOCR language codes](https://github.com/JaidedAI/EasyOCR).

## 🎯 Use Cases

- **Manufacturing QA**: Verify supplier mill certs match your specs
- **Materials Procurement**: Fast compliance check before payment
- **Regulatory**: Maintain audit trail of all reviews
- **Multi-vendor**: Compare different suppliers' certs against same spec

## 🛠️ Troubleshooting

### App won't start
```powershell
python -m pip install -r requirements.txt --upgrade
python main.py
```

### Database issues
```powershell
# Delete old database (will recreate)
rm material_review.db
python main.py
```

### OCR not extracting text
- Use PDF instead of image
- Ensure document is not scanned sideways
- Try uploading a clearer copy (300+ DPI recommended)

## 📝 Example Workflow

1. Upload **Stainless Steel Grade Spec** → System extracts: tensile strength, yield, hardness, etc.
2. Vendor sends mill cert → Upload to **New Review**
3. System compares all parameters in <5 seconds
4. Decision: Approved / Rejected / Review pending
5. View detailed comparison in history

## 🚀 Performance

- **Spec extraction**: One-time, ~2-5 seconds
- **Mill cert review**: <3 seconds (OCR + comparison)
- **Database queries**: <100ms
- Optimized for 1-10 page documents

## 📦 Dependencies

- **Flask**: Web framework
- **PyPDF2**: PDF text extraction
- **python-docx**: DOCX parsing
- **easyocr**: Multi-language OCR
- **pdf2image**: PDF to image conversion
- **Pillow**: Image processing & enhancement

See `requirements.txt` for versions.

## 📄 License

MIT License - Feel free to use and modify

## 👤 Author

Bhagya0834

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create a feature branch
3. Submit a pull request

## 📞 Support

For issues, questions, or feature requests, open an issue on GitHub.

---

**Happy Material Reviewing! 🎉**
