# Week 3 Project — Deal Screening Agent
## Mastering Agentic AI Certification, Aug 2026 Cohort

### Primer (one-liner)
My agent helps a first-time business buyer screen an SMB acquisition target in a web app, replacing the 5-10 hours of manual spreadsheet-building and back-and-forth broker questions it takes to get a first read on a deal today. It extracts the key terms from a CIM or financial summary, checks them against a red-flag/diligence checklist, and drafts a structured risk summary on its own using 3-4 tools, hands off to me to review before anything goes into an actual offer or LOI, and I'll know it works when I can get a usable first-pass screen of a real deal packet in under 15 minutes that I'd actually trust enough to decide whether to keep digging.

### Framework

| Field | Answer |
|---|---|
| Agent goal | Takes a deal document (CIM, P&L summary, or broker teaser) and produces a structured screening report with a go / dig-deeper / pass recommendation. |
| Where used | Simple web interface (Streamlit), single-user, one deal per session. |
| Steps, in order | 1. Ingest source document. 2. Extraction agent pulls structured deal terms (price, revenue, SDE/EBITDA, add-backs, customer concentration, org/key-person notes). 3. Diligence agent checks extracted terms against a standard SMB acquisition red-flag checklist. 4. Synthesis agent produces a scored summary + follow-up question list for the seller. 5. Orchestrator sequences 2-4 and assembles the final report. |
| What it can do (tools) | Read/parse uploaded document (PDF/text); look up SDE multiple benchmarks by industry (static reference table, not live web in v1); structured-output extraction call; checklist-scoring call; summary-generation call. All read/analyze only — nothing writes, sends, or modifies anything external. |
| What it remembers | Scoped to a single deal within a session only. No cross-session memory in v1. |
| What it should never do | State a valuation opinion as fact; fabricate numbers not present in the source document (must flag "not stated" rather than guess); treat broker-provided figures as verified. |
| Human-in-the-loop | 100% of output is advisory. Nothing the agent produces is acted on (no offer, no LOI, no outreach) without the user reviewing the underlying source document themselves. |
| Failure handling | If extraction can't find a required field (e.g., no SDE stated), the report explicitly flags it as missing rather than guessing or silently omitting it. |
| Success measure | Given a real or realistic deal packet, produces a screening report in under a minute that correctly surfaces the deliberately-planted red flags in the test document (customer concentration, inflated/questionable add-backs, key-person dependency). |

### Architecture
- **Track:** Code-heavy — LangChain + LangGraph (Python), per the handout's own rule: multi-agent → default to Track 2.
- **Agents:**
  1. `extraction_agent` — structured-output extraction of deal terms from the CIM text.
  2. `diligence_agent` — scores extracted terms against a checklist (customer concentration, add-back quality, key-person dependency, systems/transferability, pricing vs. broker claim reconciliation).
  3. `synthesis_agent` — produces the final report: executive summary, risk-flagged findings, and a list of specific follow-up questions to ask the seller.
  4. `orchestrator` (LangGraph graph) — sequences the three agents and passes state between them.
- **Test input:** `data/precision_air_cim.md` — synthetic CIM with deliberately planted issues (see file) for validating the agent actually catches real problems, not just summarizes politely.

### Deliverables (per handout)
1. Google Doc: project overview, datasets used, prompts used during vibe coding, iterations tried, learnings.
2. Video demo (≤5 min): walkthrough of the app, how AI coding tools were used, live demonstration.
3. GitHub repo link with code.

### Known deadline
Certification deadline: **September 16, 2026**.
