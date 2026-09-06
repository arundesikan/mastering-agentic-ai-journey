"""
Step 1: Load and clean PDF policy documents.
Run: python ingest.py
"""
import os
import re
import glob
from langchain_community.document_loaders import PyPDFLoader

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def clean_text(text: str) -> str:
    """Strip common PDF boilerplate: page numbers, repeated headers/footers."""
    text = re.sub(r"\n\s*Page \d+ of \d+\s*\n", "\n", text)
    text = re.sub(r"\n\s*\d+\s*\n", "\n", text)  # bare page numbers
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# Matches a control-family header like "RA – Risk Assessment" or "AC - Access Control"
FAMILY_RE = re.compile(r"^\s*([A-Z]{2,4})\s*[–\-]\s*([A-Za-z][A-Za-z /]{2,40})\s*$", re.MULTILINE)
# Matches a specific control line like "RA-02 | Security Categorization"
CONTROL_RE = re.compile(r"([A-Z]{2,4}-\d{1,3})\s*\|\s*([^\n|]{2,60})")


def extract_section(raw_text: str) -> str:
    """Best-effort section label for a page, so citations can say *what*
    part of the document they're from, not just a raw page number.

    Two patterns are tried, in order:
    1. NIST-style control catalogs: "<FAMILY> - <Family Name>" plus a
       specific "<ID> | <Control Name>" line (matches our Security
       Control Standards Catalog).
    2. A generic fallback: the first short, title-case-ish line on the
       page, which catches plain-prose documents like the Acceptable Use
       policy (e.g. "Executive Summary", "Personal Responsibility").
    Returns "" if nothing usable is found -- callers should fall back to
    page number alone in that case.
    """
    control_match = CONTROL_RE.search(raw_text)
    family_match = FAMILY_RE.search(raw_text)

    if control_match and family_match:
        return f"{family_match.group(1)} – {family_match.group(2).strip()} ({control_match.group(1)}: {control_match.group(2).strip()})"
    if control_match:
        return control_match.group(1) + ": " + control_match.group(2).strip()
    if family_match:
        return f"{family_match.group(1)} – {family_match.group(2).strip()}"

    # Generic fallback: first short, heading-like line.
    for line in raw_text.split("\n"):
        line = line.strip()
        if not line or line.isdigit():
            continue
        if len(line) <= 60 and not line.endswith(".") and not line.isupper():
            return line
        break  # only consider the very first non-empty line

    return ""


def load_all_pdfs():
    pdf_paths = glob.glob(os.path.join(DATA_DIR, "*.pdf"))
    if not pdf_paths:
        print(f"No PDFs found in {DATA_DIR}. Drop your policy PDFs there first.")
        return []

    all_docs = []
    for path in pdf_paths:
        loader = PyPDFLoader(path)
        pages = loader.load()
        for p in pages:
            p.metadata["section"] = extract_section(p.page_content)
            p.page_content = clean_text(p.page_content)
            p.metadata["source"] = os.path.basename(path)
            # PyPDFLoader's "page" metadata is 0-indexed; humans (and PDF
            # viewers) count pages starting at 1, so store the human-facing
            # number separately rather than silently being off by one in
            # every citation.
            p.metadata["display_page"] = p.metadata["page"] + 1
        all_docs.extend(pages)
        print(f"Loaded {len(pages)} pages from {os.path.basename(path)}")

    return all_docs


if __name__ == "__main__":
    docs = load_all_pdfs()
    print(f"\nTotal pages loaded: {len(docs)}")
