"""
diligence_agent — Step 3 of the pipeline (see PROJECT_FRAMEWORK.md).

Job: check extracted deal terms against the standard SMB acquisition
red-flag checklist and produce a list of DiligenceFinding objects.

This is the MCP piece of the project: the checklist text and the SDE
benchmark lookup are NOT hardcoded here. They're fetched from
mcp_server/deal_tools_server.py through app/mcp_client.py -- a resource
read and a tool call over the Model Context Protocol, the pattern from the
Week 3 session (FastMCP server + STDIO transport + a client that discovers
and calls what the server exposes).

Deterministic checks (concentration math, missing systems, missing fields)
are plain Python -- no reason to spend a model call on arithmetic. The one
judgment call that genuinely needs an LLM -- "is this add-back legitimate
and adequately documented?" -- gets a single Claude call.

Contract:
    input:  PipelineState with `deal_terms` populated
    output: PipelineState with `diligence_findings` populated
"""
import json
import re

from anthropic import Anthropic

from app.config import ANTHROPIC_API_KEY, DILIGENCE_MODEL
from app.state import PipelineState, DiligenceFinding
from app.mcp_client import get_sde_multiple_benchmark, get_red_flag_checklist

_client = Anthropic(api_key=ANTHROPIC_API_KEY)


def _pct_from_text(text: str) -> list[float]:
    """Pull percentages like '28%' out of a free-text concentration note."""
    return [float(m) for m in re.findall(r"(\d+(?:\.\d+)?)\s*%", text or "")]


def _check_customer_concentration(deal_terms: dict) -> DiligenceFinding:
    """Checklist has two distinct thresholds -- single customer >20% and
    top-5 combined >40% -- so we look for each separately rather than just
    taking the max percentage in the note (which would mislabel a top-5
    aggregate as a single-customer figure)."""
    note = deal_terms.get("customer_concentration")
    if not note:
        return {
            "category": "customer_concentration",
            "flag": True,
            "severity": "medium",
            "rationale": "Customer concentration not stated in the source document -- ask the seller directly rather than assuming a diversified base.",
        }

    single_pct, top5_pct = None, None
    for segment in re.split(r"[;,]", note):
        pcts = _pct_from_text(segment)
        if not pcts:
            continue
        seg_l = segment.lower()
        if "top 5" in seg_l or "top five" in seg_l or "top-5" in seg_l:
            top5_pct = max(pcts)
        elif single_pct is None:
            single_pct = max(pcts)

    if single_pct is None and top5_pct is None:
        # Note didn't split cleanly into labeled segments -- fall back to
        # treating the largest figure as an unlabeled concentration signal
        # rather than guessing which threshold it maps to.
        pcts = _pct_from_text(note)
        single_pct = max(pcts) if pcts else None

    triggered = (single_pct is not None and single_pct >= 20) or (top5_pct is not None and top5_pct >= 40)
    if triggered:
        high = (single_pct is not None and single_pct >= 30) or (top5_pct is not None and top5_pct >= 50)
        parts = []
        if single_pct is not None:
            parts.append(f"top single customer at {single_pct:.0f}%")
        if top5_pct is not None:
            parts.append(f"top 5 customers combined at {top5_pct:.0f}%")
        detail = " and ".join(parts) if parts else note
        return {
            "category": "customer_concentration",
            "flag": True,
            "severity": "high" if high else "medium",
            "rationale": f"{detail.capitalize()} ({note}). Checklist thresholds are >20% for a single customer or >40% for the top 5 combined; no long-term contract backing the relationship compounds the risk if none is mentioned.",
        }
    return {
        "category": "customer_concentration",
        "flag": False,
        "severity": "low",
        "rationale": f"Stated concentration ({note}) is below both checklist thresholds.",
    }


def _check_key_person_dependency(deal_terms: dict) -> DiligenceFinding:
    note = deal_terms.get("key_person_notes") or ""
    if not note:
        return {
            "category": "key_person_dependency",
            "flag": True,
            "severity": "medium",
            "rationale": "No key-person information stated -- transition risk is unknown, which is itself a gap worth closing before an LOI.",
        }
    signal_terms = ["license", "relationship", "sign-off", "estimator", "sole", "no crm", "notebook", "verbal", "no formal"]
    hits = [t for t in signal_terms if t in note.lower()]
    if hits:
        return {
            "category": "key_person_dependency",
            "flag": True,
            "severity": "high" if len(hits) >= 3 else "medium",
            "rationale": f"Multiple concentration signals in the owner/staff notes ({', '.join(hits)}). A transition plan should be a condition of close, not an assumption.",
        }
    return {
        "category": "key_person_dependency",
        "flag": False,
        "severity": "low",
        "rationale": "No strong single-person dependency signals found in the stated notes.",
    }


def _check_missing_fields(deal_terms: dict) -> DiligenceFinding:
    missing = deal_terms.get("missing_fields") or []
    if missing:
        return {
            "category": "data_completeness",
            "flag": True,
            "severity": "medium" if len(missing) <= 2 else "high",
            "rationale": f"Fields not stated in the source document: {', '.join(missing)}. Do not proceed to an offer without closing these gaps.",
        }
    return {
        "category": "data_completeness",
        "flag": False,
        "severity": "low",
        "rationale": "All core fields (price, revenue, SDE/EBITDA, concentration, key-person notes) were stated in the source document.",
    }


def _check_addback_quality(deal_terms: dict, checklist: str) -> DiligenceFinding:
    """The one LLM call in this agent -- judging whether claimed add-backs
    read as legitimate and adequately documented is not arithmetic."""
    add_backs = deal_terms.get("add_backs") or []
    if not add_backs:
        return {
            "category": "add_back_quality",
            "flag": False,
            "severity": "low",
            "rationale": "No add-backs claimed in the source document.",
        }

    prompt = (
        "Using this red-flag checklist for context:\n\n"
        f"{checklist}\n\n"
        "Judge the add-back quality/legitimacy for this SMB acquisition. "
        "Add-backs claimed by the seller:\n- " + "\n- ".join(add_backs) + "\n\n"
        "Respond with ONLY a JSON object: "
        '{"flag": true/false, "severity": "low"|"medium"|"high", "rationale": "1-3 sentences"}. '
        "Flag related-party compensation with a vague job description, personal-use "
        "assets, and anything undocumented. Do not flag ordinary, well-documented "
        "add-backs (e.g. a clearly-stated one-time legal settlement)."
    )
    response = _client.messages.create(
        model=DILIGENCE_MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        result = json.loads(text)
    except Exception:
        result = {"flag": True, "severity": "medium", "rationale": "Could not automatically assess add-back quality -- review manually."}

    return {
        "category": "add_back_quality",
        "flag": bool(result.get("flag", True)),
        "severity": result.get("severity", "medium"),
        "rationale": result.get("rationale", ""),
    }


def _check_sde_reconciliation(deal_terms: dict) -> DiligenceFinding:
    """Checklist item 5, done on real numbers rather than guessed from
    prose: does the document's own computed SDE match whatever a
    broker/marketing headline claims? extraction_agent hands these back as
    plain floats (see state.py) specifically so this never has to parse a
    number back out of Claude's own explanation of its work."""
    computed = deal_terms.get("sde_computed_usd")
    quoted = deal_terms.get("sde_broker_quoted_usd")

    if computed is None or quoted is None:
        return {
            "category": "sde_reconciliation",
            "flag": False,
            "severity": "low",
            "rationale": "Only one SDE/EBITDA figure found in the document -- no separate broker-quoted headline to reconcile it against.",
        }

    diff_pct = abs(computed - quoted) / max(computed, quoted) * 100
    if diff_pct >= 5:
        return {
            "category": "sde_reconciliation",
            "flag": True,
            "severity": "high" if diff_pct >= 20 else "medium",
            "rationale": f"The document's own computed SDE (${computed:,.0f}) differs from the broker-quoted figure (${quoted:,.0f}) by {diff_pct:.0f}%. Any multiple quoted off the broker's number needs to be re-run against the recomputed figure before you trust it.",
        }
    return {
        "category": "sde_reconciliation",
        "flag": False,
        "severity": "low",
        "rationale": f"Computed SDE (${computed:,.0f}) and broker-quoted figure (${quoted:,.0f}) are consistent within 5%.",
    }


def _check_price_vs_benchmark(deal_terms: dict) -> DiligenceFinding:
    """Uses the MCP tool call -- this is the one check that goes out to the
    deal_tools_server rather than staying purely local. Always benchmarks
    against the document's own COMPUTED SDE, never the broker-quoted one --
    that's what _check_sde_reconciliation is for."""
    price_value = deal_terms.get("asking_price_usd")
    # Always prefer the document's own recomputed figure over the broker's
    # headline number -- _check_sde_reconciliation is what flags a mismatch
    # between the two; this check should never silently trust the broker's.
    sde_value = deal_terms.get("sde_computed_usd") or deal_terms.get("sde_broker_quoted_usd")

    if sde_value is None or price_value is None:
        return {
            "category": "pricing_reconciliation",
            "flag": True,
            "severity": "medium",
            "rationale": "Could not extract clean numeric SDE and/or price figures to reconcile -- verify the multiple manually against the underlying numbers, not the broker's headline claim.",
        }

    implied_multiple = price_value / sde_value if sde_value else None

    benchmark = get_sde_multiple_benchmark("HVAC / commercial services")

    if implied_multiple is None or benchmark.get("typical") is None:
        return {
            "category": "pricing_reconciliation",
            "flag": True,
            "severity": "medium",
            "rationale": f"Benchmark lookup unavailable -- could not compare the implied multiple against industry norms. ({benchmark.get('source', 'no detail available')})",
        }

    high = benchmark.get("high", implied_multiple)
    flag = implied_multiple > high
    return {
        "category": "pricing_reconciliation",
        "flag": flag,
        "severity": "high" if flag and implied_multiple > high * 1.15 else ("medium" if flag else "low"),
        "rationale": (
            f"Recomputed from the document's own figures, asking price implies "
            f"{implied_multiple:.1f}x SDE, against a {benchmark.get('industry_matched') or 'generic small-business'} "
            f"benchmark range of {benchmark.get('low')}x-{benchmark.get('high')}x "
            f"(typical {benchmark.get('typical')}x, {benchmark.get('source')}). "
            + ("This is above the top of the range -- reconcile against the broker's quoted multiple, which may use a different SDE figure than the document supports."
               if flag else "This is within the benchmark range.")
        ),
    }


def run_diligence(state: PipelineState) -> PipelineState:
    deal_terms = state["deal_terms"]
    checklist = get_red_flag_checklist()  # MCP resource read

    findings = [
        _check_customer_concentration(deal_terms),
        _check_addback_quality(deal_terms, checklist),
        _check_key_person_dependency(deal_terms),
        _check_sde_reconciliation(deal_terms),
        _check_price_vs_benchmark(deal_terms),  # MCP tool call
        _check_missing_fields(deal_terms),
    ]

    return {**state, "diligence_findings": findings}
