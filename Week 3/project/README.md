# Week 3 Project — Market Research Agent (Competitor Analysis)

See `framework.txt` for the scoping (one-liner + agent framework).

## Setup
1. `pip install -r requirements.txt`
2. `cp .env.example .env` and fill in your real OpenAI API key (same key as Week 2 works)

## Run
- `cd src && python graph.py` — CLI smoke test on a default query
- `streamlit run app.py` — the actual UI for your demo video

## How it works
- `search_tool.py` — DuckDuckGo web search wrapper (no API key needed)
- `agents.py` — the 3 worker nodes: discover competitors, gather per-competitor data, extract structured fields
- `graph.py` — LangGraph state machine wiring the nodes + orchestrator
- `app.py` — Streamlit UI with a human-in-the-loop "review before save" step

## Deliverables checklist (Week 3)
- [ ] Project doc (Google Doc): overview, prompts used, iterations, learnings
- [ ] 5-min demo video walking through the app live
- [ ] Code pushed to GitHub
- [ ] Submit at https://forms.gle/HMgTU7zy6UJ8XkJX6 (NOT on Maven)
- [ ] Certification deadline: September 16, 2026
