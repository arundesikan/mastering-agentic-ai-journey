"""
Thin wrapper around a web search provider. Defaults to DuckDuckGo (free,
no API key). Swap in Tavily or you.com later by changing only this file.
"""
from langchain_community.tools import DuckDuckGoSearchResults

_search = DuckDuckGoSearchResults(output_format="list", num_results=5)


def web_search(query: str, max_results: int = 5):
    """Returns a list of {title, link, snippet} dicts. Never raises on
    zero results -- returns an empty list instead so callers can handle
    the 'nothing found' case explicitly rather than crashing."""
    try:
        results = _search.invoke(query)
        return results[:max_results] if results else []
    except Exception as e:
        print(f"[search_tool] search failed for '{query}': {e}")
        return []
