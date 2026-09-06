"""
Streamlit chat UI for the Enterprise Policy Q&A Bot.
Run: streamlit run app.py
"""
import streamlit as st
from generate import answer

st.set_page_config(page_title="Policy Q&A Bot", page_icon="📋")
st.title("📋 Enterprise Policy Q&A Bot")
st.caption("Grounded answers from your government policy PDFs — with citations.")

if "history" not in st.session_state:
    st.session_state.history = []

for role, text in st.session_state.history:
    with st.chat_message(role):
        st.markdown(text)

question = st.chat_input("Ask a question about the policy documents...")
if question:
    st.session_state.history.append(("user", question))
    with st.chat_message("user"):
        st.markdown(question)

    with st.chat_message("assistant"):
        with st.spinner("Retrieving and generating..."):
            ans, sources = answer(question)
        st.markdown(ans)
        with st.expander("Sources retrieved"):
            for d in sources:
                page = d.metadata.get("display_page", d.metadata.get("page"))
                section = d.metadata.get("section", "")
                label = f"**{d.metadata.get('source')}** — {section}, p.{page}" if section else f"**{d.metadata.get('source')}**, p.{page}"
                st.markdown(label)
                st.text(d.page_content[:300] + "...")
    st.session_state.history.append(("assistant", ans))
