"""
Shared state that flows through the LangGraph pipeline:
  extraction_agent -> diligence_agent -> synthesis_agent

Each agent reads what it needs from this state and writes its own section
back into it. Keeping this as one explicit schema (rather than passing
free-form dicts between agents) is what makes it possible to test and
evaluate each agent's output independently later.

TODO (you): flesh out the nested types below to match exactly what
extraction_agent.py ends up producing — this is a starting skeleton, not
a locked contract. Adjust as you build.
"""
from typing import TypedDict, Optional, List


class DealTerms(TypedDict, total=False):
    """Output of extraction_agent. Fields the framework calls out explicitly:
    price, revenue, SDE/EBITDA, add-backs, customer concentration,
    org/key-person notes. Anything not stated in the source doc should be
    represented as None / "not stated" rather than guessed — see
    PROJECT_FRAMEWORK.md "What it should never do".
    """
    # Dollar amounts are plain numbers (float), not prose, and deliberately
    # split apart rather than blended into one string. Earlier drafts asked
    # for "the SDE figure as a sentence" and then tried to regex a number
    # back out of Claude's own explanation of its work -- fragile, because
    # an explanation naturally contains other numbers too. A structured
    # tool-call schema exists precisely so we don't have to parse prose for
    # values arithmetic will run on.
    asking_price_usd: Optional[float]
    asking_price_terms: Optional[str]   # qualifying conditions (financing, notes) -- display only, not parsed
    revenue: Optional[str]              # informational only, no calculation depends on this
    sde_computed_usd: Optional[float]        # recomputed from the doc's own line items
    sde_broker_quoted_usd: Optional[float]   # separate headline figure from broker/marketing materials, if any
    add_backs: List[str]
    customer_concentration: Optional[str]
    key_person_notes: Optional[str]
    missing_fields: List[str]  # explicit list of anything not found in source


class DiligenceFinding(TypedDict):
    category: str          # e.g. "customer_concentration", "add_back_quality"
    flag: bool              # True if this is a red flag
    severity: str            # "low" / "medium" / "high"
    rationale: str


class ScreeningReport(TypedDict, total=False):
    """Output of synthesis_agent — the final deliverable."""
    recommendation: str      # "go" / "dig-deeper" / "pass"
    executive_summary: str
    risk_flags: List[DiligenceFinding]
    follow_up_questions: List[str]


class PipelineState(TypedDict, total=False):
    """The full state object passed through the LangGraph graph."""
    source_document_text: str        # raw ingested CIM/deal doc text
    deal_terms: DealTerms             # written by extraction_agent
    diligence_findings: List[DiligenceFinding]  # written by diligence_agent
    report: ScreeningReport           # written by synthesis_agent
