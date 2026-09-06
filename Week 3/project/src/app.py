"""
Streamlit UI for the Market Research Agent.
Run: streamlit run app.py
"""
import streamlit as st
from graph import run_research

st.set_page_config(page_title="Market Research Agent", page_icon="🔎")
st.title("🔎 Market Research Agent")
st.caption("Multi-agent competitor analysis — discover, gather, extract, compile.")

query = st.text_input(
    "Enter a market/segment or a specific competitor name",
    placeholder="e.g. GovTech infrastructure consulting for state and local government",
)

if st.button("Research") and query:
    with st.spinner("Discovering competitors -> gathering data -> extracting -> compiling..."):
        result = run_research(query)

    st.subheader("Draft briefing (review before saving)")
    st.markdown(result["briefing"])

    if st.button("Approve & save to disk"):
        with open("../briefing_output.md", "w") as f:
            f.write(result["briefing"])
        st.success("Saved to briefing_output.md")
