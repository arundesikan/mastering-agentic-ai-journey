"""
synthesis_agent — Step 4 of the pipeline (see PROJECT_FRAMEWORK.md).

Job: turn deal_terms + diligence_findings into the final ScreeningReport --
executive summary, risk-flagged findings, go/dig-deeper/pass
recommendation, and a list of specific follow-up questions for the seller.

Hard constraint from the framework's "what it should never do" row: never
state a valuation opinion as fact. The system prompt below enforces that
the recommendation reads as an advisory screening signal, not a verdict --
this is also why main.py never lets the report auto-trigger any action.

Contract:
    input:  PipelineState with `deal_terms` and `diligence_findings` populated
    output: PipelineState with `report` populated
"""
import json

from anthropic import Anthropic

from app.config import ANTHROPIC_API_KEY, SYNTHESIS_MODEL
from app.state import PipelineState, ScreeningReport

_client = Anthropic(api_key=ANTHROPIC_API_KEY)

_SYNTHESIS_TOOL = {
    "name": "record_screening_report",
    "description": "Record the final deal screening report.",
    "input_schema": {
        "type": "object",
        "properties": {
            "recommendation": {
                "type": "string",
                "enum": ["go", "dig-deeper", "pass"],
                "description": "Advisory screening signal, not a valuation opinion or a decision.",
            },
            "executive_summary": {
                "type": "string",
                "description": "3-5 sentence plain-language summary of the deal and why it lands where it does.",
            },
            "follow_up_questions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Specific questions to send the seller/broker, directly tied to the flagged findings and any missing fields.",
            },
        },
        "required": ["recommendation", "executive_summary", "follow_up_questions"],
    },
}

_SYSTEM_PROMPT = """You are the synthesis stage of an SMB acquisition deal-screening pipeline.

You are producing an ADVISORY screening report for a prospective buyer to review -- not a valuation, not a go/no-go decision, and not something that gets acted on automatically. Never state a dollar valuation or a "this deal is worth X" opinion as fact. Never soften or omit a high-severity flag you're given -- your job is to make risks visible, not to make the deal look better than the underlying findings support.

The recommendation field is a screening signal only:
- "go" = no high-severity flags, proceed to deeper diligence with confidence
- "dig-deeper" = at least one medium/high flag needs resolution before an LOI, but nothing disqualifying on its face
- "pass" = multiple high-severity flags or a fundamental data/pricing problem that would need to be resolved before this is investable

Write follow-up questions as things the buyer would actually send the seller or broker -- specific to what was flagged or marked missing, not generic diligence boilerplate."""


def run_synthesis(state: PipelineState) -> PipelineState:
    deal_terms = state["deal_terms"]
    findings = state["diligence_findings"]

    findings_summary = "\n".join(
        f"- [{f['severity'].upper()}{'  FLAGGED' if f['flag'] else ''}] {f['category']}: {f['rationale']}"
        for f in findings
    )

    prompt = (
        f"Deal terms extracted from the source document:\n{json.dumps(deal_terms, indent=2)}\n\n"
        f"Diligence findings:\n{findings_summary}\n\n"
        "Produce the screening report via the record_screening_report tool."
    )

    response = _client.messages.create(
        model=SYNTHESIS_MODEL,
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        tools=[_SYNTHESIS_TOOL],
        tool_choice={"type": "tool", "name": "record_screening_report"},
        messages=[{"role": "user", "content": prompt}],
    )

    tool_call = next(block for block in response.content if block.type == "tool_use")
    raw: dict = tool_call.input

    report: ScreeningReport = {
        "recommendation": raw.get("recommendation", "dig-deeper"),
        "executive_summary": raw.get("executive_summary", ""),
        "risk_flags": findings,
        "follow_up_questions": raw.get("follow_up_questions", []),
    }

    return {**state, "report": report}
