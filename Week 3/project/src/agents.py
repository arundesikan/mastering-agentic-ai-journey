"""
The three worker "agents" (LangGraph nodes) plus the compile step that the
orchestrator graph (graph.py) wires together.

State shape (a plain dict, passed between nodes):
{
    "input": str,                      # market/segment OR a specific competitor name
    "competitors": list[str],
    "gathered": dict[str, list[dict]], # competitor -> search results
    "extracted": dict[str, dict],      # competitor -> structured fields
    "briefing": str,                   # final compiled markdown
    "retries": dict[str, int],         # competitor -> retry count for gather step
}
"""
import os
import json
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from search_tool import web_search

load_dotenv()

llm = ChatOpenAI(
    model=os.getenv("CHAT_MODEL", "gpt-4o-mini"),
    base_url=os.getenv("OPENAI_BASE_URL"),
    temperature=0,
)


def discover_node(state: dict) -> dict:
    """Agent 1: find up to 3 competitors for the given market/segment.
    If the input already looks like a single company name, skip search
    and just use it directly (lets the user bring their own use case)."""
    user_input = state["input"]

    results = web_search(f"top competitors in {user_input} market 2026", max_results=6)
    if not results:
        # Fall back: treat the input itself as a single target competitor.
        return {**state, "competitors": [user_input]}

    context = "\n".join(f"- {r.get('title', '')}: {r.get('snippet', '')}" for r in results)
    prompt = (
        f"Based on these search results about the market '{user_input}', "
        f"list up to 3 real company names that are competitors/players in "
        f"this space. Return ONLY a JSON array of strings, nothing else.\n\n{context}"
    )
    resp = llm.invoke(prompt).content
    try:
        competitors = json.loads(resp)
        if not isinstance(competitors, list) or not competitors:
            raise ValueError
    except Exception:
        competitors = [user_input]

    return {**state, "competitors": competitors[:3]}


def gather_node(state: dict) -> dict:
    """Agent 2: run targeted searches per competitor. Retries once on a
    zero-result search before giving up on that competitor."""
    gathered = {}
    retries = state.get("retries", {})

    for comp in state["competitors"]:
        results = web_search(f"{comp} services pricing positioning news 2026")
        if not results:
            retries[comp] = retries.get(comp, 0) + 1
            results = web_search(f"{comp} company overview")  # one retry, broader query

        gathered[comp] = results

    return {**state, "gathered": gathered, "retries": retries}


def extract_node(state: dict) -> dict:
    """Agent 3: extract structured fields per competitor from gathered
    search results. Explicitly marks fields it could not verify instead
    of guessing."""
    extracted = {}

    for comp, results in state["gathered"].items():
        if not results:
            extracted[comp] = {
                "services": "not found in available sources",
                "positioning": "not found in available sources",
                "recent_news": "not found in available sources",
                "sources": [],
            }
            continue

        context = "\n".join(
            f"- {r.get('title', '')}: {r.get('snippet', '')} ({r.get('link', '')})"
            for r in results
        )
        prompt = (
            f"From these search snippets about '{comp}', extract:\n"
            f"1. services (what they offer)\n2. positioning (how they present themselves)\n"
            f"3. recent_news (anything notable/recent)\n"
            f"If a field isn't supported by the snippets, say "
            f"'not found in available sources' for that field. "
            f"Return ONLY valid JSON with keys services, positioning, recent_news.\n\n{context}"
        )
        resp = llm.invoke(prompt).content
        try:
            fields = json.loads(resp)
        except Exception:
            fields = {
                "services": "not found in available sources",
                "positioning": "not found in available sources",
                "recent_news": "not found in available sources",
            }
        fields["sources"] = [r.get("link", "") for r in results]
        extracted[comp] = fields

    return {**state, "extracted": extracted}


def compile_node(state: dict) -> dict:
    """Compiles the final markdown briefing. This is the human-in-the-loop
    checkpoint -- the graph stops here and the UI shows this for review
    before anything is saved to disk."""
    lines = [f"# Competitor Analysis Briefing: {state['input']}", ""]
    for comp, fields in state["extracted"].items():
        lines.append(f"## {comp}")
        lines.append(f"**Services:** {fields.get('services')}")
        lines.append(f"**Positioning:** {fields.get('positioning')}")
        lines.append(f"**Recent news:** {fields.get('recent_news')}")
        sources = fields.get("sources", [])
        if sources:
            lines.append("**Sources:** " + ", ".join(sources))
        lines.append("")

    briefing = "\n".join(lines)
    return {**state, "briefing": briefing}
