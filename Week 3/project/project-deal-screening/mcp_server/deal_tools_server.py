"""
MCP server for the Deal Screening Agent — the Week 3 MCP piece.

Rather than hardcoding the SDE-multiple benchmark table and the red-flag
checklist directly into diligence_agent.py, we expose them through an MCP
server: a TOOL (get_sde_multiple_benchmark) and a RESOURCE (the checklist
document), same shape as the FastMCP + STDIO pattern from the Week 3 live
session demo. diligence_agent.py connects to this as an MCP CLIENT rather
than importing these functions directly.

Why bother for something this small? Because it's the pattern that matters
for the course, not the scale — MCP's actual value shows up once you have
many tools/many agents needing the same tool catalog. Here it demonstrates:
tool discovery (get_tools()), a callable tool with a typed argument, and a
static resource served over the same protocol.

Run standalone for debugging with the MCP Inspector:
    mcp dev mcp_server/deal_tools_server.py

Run as a real server (this is what deal_mcp_client.py launches via STDIO):
    python mcp_server/deal_tools_server.py
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("deal-screening-tools")

# Static reference table: typical SDE-multiple ranges by industry, for SMB
# "main street" acquisitions (roughly $1M-$5M enterprise value range).
# Deliberately not live web data — see PROJECT_FRAMEWORK.md: "look up SDE
# multiple benchmarks by industry (static reference table, not live web
# in v1)".
_SDE_BENCHMARKS = {
    "hvac / commercial services": {"low": 2.5, "typical": 3.0, "high": 3.7},
    "field services (general trades)": {"low": 2.2, "typical": 2.8, "high": 3.5},
    "residential services": {"low": 2.0, "typical": 2.6, "high": 3.2},
    "light manufacturing": {"low": 2.8, "typical": 3.5, "high": 4.5},
    "professional services": {"low": 2.0, "typical": 2.7, "high": 3.6},
    "retail (brick and mortar)": {"low": 1.5, "typical": 2.0, "high": 2.8},
    "healthcare services (non-medical)": {"low": 2.8, "typical": 3.6, "high": 4.8},
    "distribution / wholesale": {"low": 2.3, "typical": 3.0, "high": 4.0},
}

_DEFAULT_BENCHMARK = {"low": 2.0, "typical": 2.8, "high": 3.5}

_RED_FLAG_CHECKLIST = """\
# SMB Acquisition Red-Flag Checklist

1. Customer concentration — any single customer >20% of revenue, or top 5
   customers >40% of revenue, is a red flag. No written multi-year
   contracts backing a concentrated relationship raises severity further.
2. Add-back quality — each claimed add-back needs a plausible, verifiable
   business rationale. Related-party compensation (family members, unclear
   job descriptions), personal-use assets, and anything without
   documentation should be flagged, not accepted at face value.
3. Key-person dependency — flag when licenses, banking relationships,
   estimating/sales authority, or customer relationships are concentrated
   in one person with no documented transition or succession plan.
4. Systems & transferability — flag the absence of a CRM, documented SOPs,
   or any system of record; if the business runs on one person's memory
   and a notebook, transferability risk is high regardless of financial
   performance.
5. Price vs. broker claim reconciliation — always recompute SDE/EBITDA
   from the underlying line items in the document itself and compare
   against whatever multiple or headline figure the broker's marketing
   materials state. Flag any mismatch explicitly; never adopt the broker's
   number without recomputation.

Severity guide: "high" = could kill the deal or materially change price;
"medium" = must be resolved before LOI; "low" = worth a follow-up question
but not independently disqualifying.
"""


@mcp.tool()
def get_sde_multiple_benchmark(industry: str) -> dict:
    """Look up the typical SDE-multiple range (low/typical/high) for an SMB
    in the given industry. Uses a static reference table, not live market
    data. Falls back to a generic small-business range if the industry
    isn't in the table, and says so explicitly rather than pretending it's
    a real match.

    Args:
        industry: freeform industry description, e.g. "HVAC / commercial
            services". Matched case-insensitively against known categories.
    """
    key = industry.strip().lower()
    for category, benchmark in _SDE_BENCHMARKS.items():
        if key in category or category in key:
            return {
                "industry_matched": category,
                "matched": True,
                **benchmark,
                "source": "static reference table (v1) — not live market data",
            }
    return {
        "industry_matched": None,
        "matched": False,
        **_DEFAULT_BENCHMARK,
        "source": "generic small-business fallback range — no specific "
        "industry match found, treat as low-confidence",
    }


@mcp.resource("checklist://red-flags/smb-acquisition")
def red_flag_checklist() -> str:
    """The standard SMB acquisition red-flag checklist that diligence_agent
    scores extracted deal terms against."""
    return _RED_FLAG_CHECKLIST


if __name__ == "__main__":
    mcp.run(transport="stdio")
