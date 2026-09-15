"""
The LangGraph orchestrator -- sequences extraction_agent -> diligence_agent
-> synthesis_agent, per PROJECT_FRAMEWORK.md.

extraction and synthesis call Claude directly; diligence calls Claude once
(add-back judgment) AND talks to the local MCP server (mcp_server/deal_tools_server.py)
for the red-flag checklist resource and the SDE-benchmark tool -- see
app/mcp_client.py and app/agents/diligence_agent.py for that piece.
"""
from langgraph.graph import StateGraph, END

from app.state import PipelineState
from app.agents.extraction_agent import run_extraction
from app.agents.diligence_agent import run_diligence
from app.agents.synthesis_agent import run_synthesis


def build_graph():
    graph = StateGraph(PipelineState)
    graph.add_node("extraction", run_extraction)
    graph.add_node("diligence", run_diligence)
    graph.add_node("synthesis", run_synthesis)

    graph.set_entry_point("extraction")
    graph.add_edge("extraction", "diligence")
    graph.add_edge("diligence", "synthesis")
    graph.add_edge("synthesis", END)

    return graph.compile()


_app = build_graph()


def run_screening(source_document_text: str) -> PipelineState:
    initial_state: PipelineState = {"source_document_text": source_document_text}
    return _app.invoke(initial_state)


if __name__ == "__main__":
    import sys
    from pathlib import Path

    doc_path = sys.argv[1] if len(sys.argv) > 1 else "data/precision_air_cim.md"
    text = Path(doc_path).read_text()
    result = run_screening(text)

    report = result["report"]
    print(f"\nRECOMMENDATION: {report['recommendation'].upper()}\n")
    print(report["executive_summary"])
    print("\nRisk flags:")
    for f in report["risk_flags"]:
        marker = "FLAG" if f["flag"] else "ok"
        print(f"  [{marker} - {f['severity']}] {f['category']}: {f['rationale']}")
    print("\nFollow-up questions for the seller:")
    for q in report["follow_up_questions"]:
        print(f"  - {q}")
