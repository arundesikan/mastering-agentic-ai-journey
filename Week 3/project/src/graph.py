"""
Orchestrator: wires the 3 worker nodes + compile step into a LangGraph
state machine. Run directly for a CLI smoke test, or import `run_research`
from app.py.
"""
from langgraph.graph import StateGraph, END
from agents import discover_node, gather_node, extract_node, compile_node


def build_graph():
    graph = StateGraph(dict)
    graph.add_node("discover", discover_node)
    graph.add_node("gather", gather_node)
    graph.add_node("extract", extract_node)
    graph.add_node("compile", compile_node)

    graph.set_entry_point("discover")
    graph.add_edge("discover", "gather")
    graph.add_edge("gather", "extract")
    graph.add_edge("extract", "compile")
    graph.add_edge("compile", END)

    return graph.compile()


_app = build_graph()


def run_research(market_or_competitor: str) -> dict:
    initial_state = {"input": market_or_competitor}
    return _app.invoke(initial_state)


if __name__ == "__main__":
    result = run_research("GovTech infrastructure consulting for state and local government")
    print(result["briefing"])
