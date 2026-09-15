"""
extraction_agent — Step 2 of the pipeline (see PROJECT_FRAMEWORK.md).

Job: read the raw deal document text and pull out structured deal terms
(price, revenue, SDE/EBITDA, add-backs, customer concentration,
org/key-person notes) as a DealTerms object.

Uses Claude's structured output via tool-use (a single forced tool call
whose input schema *is* the DealTerms shape) rather than asking for JSON
in prose and hoping it parses. This is the more reliable structured-output
pattern for Claude: the model can't return anything except a valid call
against the schema.

Contract:
    input:  PipelineState with `source_document_text` populated
    output: PipelineState with `deal_terms` populated
"""
import json

from anthropic import Anthropic

from app.config import ANTHROPIC_API_KEY, EXTRACTION_MODEL
from app.state import PipelineState, DealTerms

_client = Anthropic(api_key=ANTHROPIC_API_KEY)

# The tool's input_schema doubles as our structured-output contract: Claude
# must fill in exactly this shape, no free-text JSON parsing required.
_EXTRACTION_TOOL = {
    "name": "record_deal_terms",
    "description": "Record the structured deal terms extracted from the source document.",
    "input_schema": {
        "type": "object",
        "properties": {
            "asking_price_usd": {"type": ["number", "null"], "description": "The asking price in US dollars as a PLAIN NUMBER -- no '$', no commas, no words (e.g. 2400000, not '$2.4M' or '2,400,000'). Null if not stated."},
            "asking_price_terms": {"type": ["string", "null"], "description": "Any qualifying conditions attached to the price -- financing terms, seller notes, contingencies -- as free text for display only. Null if none stated."},
            "revenue": {"type": ["string", "null"], "description": "Most recent period revenue as stated, or null."},
            "sde_computed_usd": {"type": ["number", "null"], "description": "SDE/EBITDA recomputed from the document's own line items (e.g. summed from a financial table), as a PLAIN NUMBER -- no '$', no commas. Null if the document gives no line items to compute from."},
            "sde_broker_quoted_usd": {"type": ["number", "null"], "description": "A SEPARATE broker/marketing headline SDE or EBITDA figure, as a PLAIN NUMBER, ONLY if the document states one that differs from or exists independently of the computed figure. Null otherwise -- do not repeat the computed figure here."},
            "add_backs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Each add-back line item claimed by the seller, verbatim or lightly paraphrased, with its dollar amount.",
            },
            "customer_concentration": {"type": ["string", "null"], "description": "Concentration facts as stated (e.g. top customer %, top-5 %), or null if not discussed."},
            "key_person_notes": {"type": ["string", "null"], "description": "Anything about owner/staff dependency, licenses, relationships held by one person, or null."},
            "missing_fields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Names of any of the above fields that were NOT stated in the source document. Never guess a number to fill a gap -- list it here instead.",
            },
        },
        "required": ["asking_price_usd", "asking_price_terms", "revenue", "sde_computed_usd", "sde_broker_quoted_usd", "add_backs", "customer_concentration", "key_person_notes", "missing_fields"],
    },
}

_SYSTEM_PROMPT = """You are the extraction stage of an SMB acquisition deal-screening pipeline.

Pull ONLY what is explicitly stated in the source document into the record_deal_terms tool call. Do not calculate a number yourself, but DO transcribe a total the document itself already computed (e.g. an SDE line that sums add-backs). If a field isn't stated, put it in missing_fields and leave the field null (or an empty list for add_backs).

All _usd fields are plain numbers, not text -- if you'd naturally write "$1,001,900" or "approximately 2.4 million", put 1001900 or 2400000 in the number field instead, and put any explanation or qualifying detail in the matching _terms/notes field or leave it out entirely. Never put a number as a string.

sde_computed_usd and sde_broker_quoted_usd are deliberately separate fields -- never conflate them. If the document states both a computed figure AND a separate broker/marketing headline number, put each in its own field so the diligence step can reconcile them itself. If there's only one figure in the document, put it in sde_computed_usd and leave sde_broker_quoted_usd null -- do not duplicate the same number into both fields.

This is a read-only extraction task. You are not evaluating the deal, only transcribing what the document says."""


def run_extraction(state: PipelineState) -> PipelineState:
    document_text = state["source_document_text"]

    response = _client.messages.create(
        model=EXTRACTION_MODEL,
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        tools=[_EXTRACTION_TOOL],
        tool_choice={"type": "tool", "name": "record_deal_terms"},
        messages=[
            {
                "role": "user",
                "content": f"Extract the deal terms from this document:\n\n{document_text}",
            }
        ],
    )

    tool_call = next(block for block in response.content if block.type == "tool_use")
    raw: dict = tool_call.input

    deal_terms: DealTerms = {
        "asking_price_usd": raw.get("asking_price_usd"),
        "asking_price_terms": raw.get("asking_price_terms"),
        "revenue": raw.get("revenue"),
        "sde_computed_usd": raw.get("sde_computed_usd"),
        "sde_broker_quoted_usd": raw.get("sde_broker_quoted_usd"),
        "add_backs": raw.get("add_backs", []),
        "customer_concentration": raw.get("customer_concentration"),
        "key_person_notes": raw.get("key_person_notes"),
        "missing_fields": raw.get("missing_fields", []),
    }

    return {**state, "deal_terms": deal_terms}
