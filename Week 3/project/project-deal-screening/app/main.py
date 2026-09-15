"""
Streamlit entry point -- per PROJECT_FRAMEWORK.md: simple web interface,
single-user, one deal per session.

Run with: streamlit run app/main.py

Human-in-the-loop, per the framework: 100% of output is advisory. Nothing
here sends, saves externally, or triggers any downstream action -- it's a
read-only screen for the person to review before they do anything with a
real deal.
"""
import io
import sys
from pathlib import Path

# Streamlit only adds this file's own folder (app/) to Python's import path,
# not the project root above it -- so "from app.graph import ..." below
# fails with "No module named 'app'" unless we add the root ourselves.
# This makes the app launchable with either `streamlit run app/main.py` or
# `python -m streamlit run app/main.py`, from any working directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import streamlit as st
from pypdf import PdfReader

from app.graph import run_screening

st.set_page_config(page_title="Deal Screening Agent", layout="wide")

st.title("Deal Screening Agent")
st.caption(
    "Upload a deal document (CIM, P&L summary, or broker teaser) to get a "
    "structured screening report. Advisory only -- always verify against "
    "the source document yourself before acting on anything below."
)


def _safe(text) -> str:
    """Escape '$' before handing text to st.write/markdown.

    Streamlit renders anything between two '$' as a LaTeX formula (a
    Markdown/MathJax feature, not a bug in our data) -- so any rationale or
    summary containing two or more dollar amounts, like "$1,001,900 differs
    from $780,000", gets silently mangled into a math expression instead of
    displaying as text. Escaping to '\\$' disables that per Streamlit's own
    docs while leaving the visible text unchanged.
    """
    if text is None:
        return ""
    return str(text).replace("$", "\\$")


def _extract_text(uploaded_file) -> str:
    if uploaded_file.type == "application/pdf" or uploaded_file.name.lower().endswith(".pdf"):
        reader = PdfReader(io.BytesIO(uploaded_file.getvalue()))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    return uploaded_file.getvalue().decode("utf-8", errors="replace")


uploaded_file = st.file_uploader("Upload deal document", type=["pdf", "txt", "md"])

if uploaded_file is not None and st.button("Run screening"):
    with st.spinner("Extracting terms -> running diligence checks (incl. MCP tool/resource calls) -> synthesizing report..."):
        try:
            document_text = _extract_text(uploaded_file)
            st.session_state["result"] = run_screening(document_text)
            st.session_state["error"] = None
        except Exception as e:
            st.session_state["result"] = None
            st.session_state["error"] = str(e)

if st.session_state.get("error"):
    st.error(f"Something broke in the pipeline: {st.session_state['error']}")

if st.session_state.get("result"):
    result = st.session_state["result"]
    report = result["report"]
    deal_terms = result["deal_terms"]

    rec = report["recommendation"]
    rec_color = {"go": "green", "dig-deeper": "orange", "pass": "red"}.get(rec, "gray")
    st.markdown(f"## Recommendation: :{rec_color}[{rec.upper()}]")
    st.caption("Advisory screening signal only -- not a valuation, not a decision.")

    st.subheader("Executive summary")
    st.write(_safe(report["executive_summary"]))

    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("Deal terms (as extracted)")
        price = deal_terms.get("asking_price_usd")
        price_str = f"${price:,.0f}" if price is not None else "_not stated_"
        if deal_terms.get("asking_price_terms"):
            price_str += f" ({deal_terms['asking_price_terms']})"
        st.write(f"**Asking price:** {_safe(price_str)}")
        st.write(f"**Revenue:** {_safe(deal_terms.get('revenue') or '_not stated_')}")
        sde_computed = deal_terms.get("sde_computed_usd")
        st.write(f"**SDE / EBITDA (computed from document):** {_safe(f'${sde_computed:,.0f}') if sde_computed is not None else '_not stated_'}")
        sde_quoted = deal_terms.get("sde_broker_quoted_usd")
        if sde_quoted is not None:
            st.write(f"**SDE / EBITDA (broker-quoted):** {_safe(f'${sde_quoted:,.0f}')}")
        st.write(f"**Customer concentration:** {_safe(deal_terms.get('customer_concentration') or '_not stated_')}")
        st.write(f"**Key-person notes:** {_safe(deal_terms.get('key_person_notes') or '_not stated_')}")
        if deal_terms.get("add_backs"):
            st.write("**Add-backs claimed:**")
            for ab in deal_terms["add_backs"]:
                st.write(f"- {_safe(ab)}")
        if deal_terms.get("missing_fields"):
            st.warning("Not stated in the source document: " + ", ".join(deal_terms["missing_fields"]))

    with col2:
        st.subheader("Risk flags")
        severity_icon = {"high": "🔴", "medium": "🟠", "low": "🟢"}
        for f in report["risk_flags"]:
            icon = severity_icon.get(f["severity"], "⚪") if f["flag"] else "✅"
            st.markdown(f"{icon} **{f['category'].replace('_', ' ').title()}** ({f['severity']})")
            st.caption(_safe(f["rationale"]))

    st.subheader("Follow-up questions for the seller")
    for q in report["follow_up_questions"]:
        st.write(f"- {_safe(q)}")

    st.divider()
    st.caption(
        "This report is generated from the uploaded document only. It does not "
        "verify seller-provided figures, does not constitute a valuation, and "
        "nothing above should go into an offer or LOI without you reviewing "
        "the source document directly."
    )
