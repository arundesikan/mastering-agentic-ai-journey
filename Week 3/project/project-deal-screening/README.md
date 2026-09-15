# Deal Screening Agent — Week 3 Project

Mastering Agentic AI Certification, Aug 2026 cohort. See `PROJECT_FRAMEWORK.md`
for the full scoping (goal, architecture, agents, deliverables, deadline).

## Project structure

```
project-deal-screening/
├── PROJECT_FRAMEWORK.md      # scoping doc
├── README.md                  # this file
├── requirements.txt
├── .env.example                # copy to .env, add your own key
├── .gitignore
├── data/
│   └── precision_air_cim.md   # synthetic test CIM with planted red flags
├── mcp_server/
│   └── deal_tools_server.py   # MCP server: SDE-benchmark tool + red-flag-checklist resource
└── app/
    ├── config.py               # loads API key + model names from .env
    ├── state.py                 # shared LangGraph state schema
    ├── mcp_client.py             # sync wrapper around the MCP server (STDIO)
    ├── graph.py                  # LangGraph orchestrator
    ├── main.py                    # Streamlit entry point
    └── agents/
        ├── extraction_agent.py    # Claude structured-output extraction
        ├── diligence_agent.py     # deterministic checks + 1 LLM call + MCP calls
        └── synthesis_agent.py     # final report generation

```

## Setup

```bash
cd project-deal-screening
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # then add your real ANTHROPIC_API_KEY
```

Verify the key loaded:

```bash
python -c "from app.config import ANTHROPIC_API_KEY; print('Key loaded:', bool(ANTHROPIC_API_KEY))"
```

## Run

```bash
# CLI smoke test against the sample CIM
python -m app.graph

# Full app
streamlit run app/main.py
```

Upload `data/precision_air_cim.md` (or any CIM/teaser as .pdf/.txt/.md) and click
"Run screening." The pipeline should correctly surface all three
deliberately-planted issues in the sample document: the 28%/45% customer
concentration, the sister-in-law "Office Manager" add-back, and the
key-person dependency (licenses, banking relationships, no CRM/SOPs all
resting on one person).

## How it works

1. **extraction_agent** — a single forced Claude tool-call whose input
   schema *is* the deal-terms shape, so the model can't return anything
   except valid structured output. Anything not stated in the source
   document is listed in `missing_fields` rather than guessed.
2. **diligence_agent** — runs 5 checks against the extracted terms:
   customer concentration, add-back quality, key-person dependency, price-
   vs-broker-SDE reconciliation, and data completeness. Deterministic
   checks (percentage math, keyword signals) stay plain Python; add-back
   *legitimacy* is a judgment call, so that one gets a single Claude call.
3. **synthesis_agent** — turns the deal terms + findings into the final
   report: a go / dig-deeper / pass **screening signal** (never a
   valuation opinion — enforced in the system prompt), an executive
   summary, and specific follow-up questions for the seller.
4. **graph.py** — a LangGraph `StateGraph` sequencing the three nodes.
5. **main.py** — Streamlit upload → run → review. Nothing is sent, saved
   externally, or acted on automatically — 100% advisory, per the
   framework's human-in-the-loop row.

### The MCP piece (Week 3's other big topic)

The red-flag checklist and the SDE-multiple benchmark table aren't
hardcoded into `diligence_agent.py`. They're served by
`mcp_server/deal_tools_server.py` — a small **FastMCP** server exposing:

- a **tool**, `get_sde_multiple_benchmark(industry)`, that looks up a
  static SDE-multiple range by industry;
- a **resource**, `checklist://red-flags/smb-acquisition`, that serves the
  red-flag checklist document.

`app/mcp_client.py` connects to that server over **STDIO** (spawns it as a
subprocess, same transport used in the Week 3 live-session demo),
discovers the tool/resource, and calls them. `diligence_agent.py` never
imports the checklist or benchmark table directly — it goes through the
MCP client, same as an agent would go through MCP to reach any external
tool catalog. If the MCP server can't be reached, the client degrades to a
minimal inline fallback rather than crashing the whole pipeline.

You can inspect the server standalone (no LLM involved) with:

```bash
mcp dev mcp_server/deal_tools_server.py
```

This is a small-scale use of MCP — the instructor was explicit in Live
Session 2 that MCP is a design choice, not a requirement, and pays off
most at multi-tool/multi-system scale. Here it's used deliberately to
demonstrate the pattern (tool discovery, resource serving, STDIO
transport) on a real piece of this project rather than leaving it purely
conceptual.

### Why raw Anthropic SDK, not `langchain-anthropic`

`extraction_agent` and `synthesis_agent` need **forced** structured
output — the model must return exactly one specific tool call, no prose,
no choice. The Anthropic SDK's `tool_choice={"type": "tool", "name": ...}`
does this directly. LangGraph is still doing the actual orchestration
(the multi-step, stateful part of "agentic" this week is about); the
model-calling layer just doesn't need LangChain's chat-model abstraction
on top of it for this project.

## What's built

- ✅ Project structure, dependency list, config/env loading, shared state
  schema, Streamlit UI
- ✅ `extraction_agent.py` — Claude structured-output extraction
- ✅ `diligence_agent.py` — checklist scoring, including the two MCP calls
- ✅ `synthesis_agent.py` — report generation
- ✅ `graph.py` — full pipeline wired and runnable
- ✅ `mcp_server/deal_tools_server.py` + `app/mcp_client.py` — the MCP piece
- ✅ `main.py` — file upload → pipeline → report display, wired end to end

## Notes on `app/state.py`

This is the shared contract every agent reads from and writes to. Field
names were kept as originally scoped in `PROJECT_FRAMEWORK.md` — no
changes needed once `extraction_agent` was actually built.
