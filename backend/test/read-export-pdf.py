"""Portable PDF assertions; requires pypdf and pdfplumber in EXPORT_PYTHON_BIN."""
import json
import sys
import pdfplumber
from pypdf import PdfReader

source = sys.argv[1]
reader = PdfReader(source)
pages = [page.extract_text() or "" for page in reader.pages]
invalid_unicode_mappings = 0
for page in reader.pages:
    for font in page["/Resources"].get("/Font", {}).values():
        cmap = font.get_object().get("/ToUnicode")
        if cmap:
            invalid_unicode_mappings += cmap.get_object().get_data().count(b"<>")
overflow = []
rectangle_overflow = []
with pdfplumber.open(source) as document:
    for index, page in enumerate(document.pages):
        for char in page.chars:
            if char["text"].strip() and (
                char["x0"] < 44 or char["x1"] > page.width - 44
                or char["top"] < 15 or char["bottom"] > page.height - 40
            ):
                overflow.append({"page": index + 1, "text": char["text"]})
        for rect in page.rects:
            if (rect["x0"] < 44 or rect["x1"] > page.width - 44
                    or rect["top"] < 44 or rect["bottom"] > page.height - 44):
                rectangle_overflow.append(index + 1)
print(json.dumps({"pages": pages, "overflow": overflow,
                  "rectangleOverflow": rectangle_overflow,
                  "invalidUnicodeMappings": invalid_unicode_mappings}, ensure_ascii=True))
