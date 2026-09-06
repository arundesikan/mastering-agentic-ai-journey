"""
Runs the 15-question evaluation set required for the Week 2 deliverable
and writes a markdown report with retrieval quality notes.
Run: python eval.py
"""
import os
import json
from datetime import datetime
from generate import answer

# EDIT THIS: replace with real questions once you know your actual PDFs.
# Mix of: easy lookups, multi-document questions, and questions the corpus
# genuinely cannot answer (to test the refusal path).
QUESTIONS = [
    "What is the policy on data classification levels?",
    "Who is responsible for approving new software procurement?",
    "What are the incident reporting requirements for a data breach?",
    "What is the retention period for system access logs?",
    "What encryption standards are required for data at rest?",
    "What is the process for requesting an exception to a security policy?",
    "How often must risk assessments be conducted?",
    "What training is required for employees handling sensitive data?",
    "What is the policy on using personal devices for work? (multi-doc)",
    "What vendor security requirements apply to third-party contractors?",
    "What is the escalation path if a vendor fails a security review?",
    "What is the policy on cloud service provider approval?",
    "What is the CEO's personal cell phone number?",  # should refuse
    "What is the weather forecast for next week?",  # should refuse — out of scope
    "Summarize all policies related to remote work in one paragraph.",
]

REPORT_PATH = os.path.join(os.path.dirname(__file__), "..", "eval_report.md")


def run_eval():
    lines = [f"# Week 2 RAG Evaluation Report", f"Generated: {datetime.now().isoformat()}", ""]
    for i, q in enumerate(QUESTIONS, 1):
        ans, sources = answer(q)
        refused = "could not find" in ans.lower()
        lines.append(f"## Q{i}: {q}")
        lines.append(f"**Answer:** {ans}")
        lines.append(f"**Refused/out-of-scope:** {'Yes' if refused else 'No'}")

        def _label(d):
            page = d.metadata.get("display_page", d.metadata.get("page"))
            section = d.metadata.get("section", "")
            return f"{d.metadata.get('source')} — {section}, p.{page}" if section else f"{d.metadata.get('source')} p.{page}"

        lines.append(f"**Sources used:** " + ", ".join(_label(d) for d in sources))
        lines.append("**Your notes on retrieval quality:** _(fill in — was this right, partially right, or wrong?)_")
        lines.append("")

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Wrote report to {REPORT_PATH}")


if __name__ == "__main__":
    run_eval()
