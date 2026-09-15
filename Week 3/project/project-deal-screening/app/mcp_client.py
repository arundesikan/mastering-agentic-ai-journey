"""
Thin MCP client wrapper — connects to mcp_server/deal_tools_server.py over
STDIO (same transport taught in the Week 3 session for a local server),
fetches its tool + resource, and exposes them as plain sync Python calls so
diligence_agent.py doesn't need to know anything about MCP itself.

The MCP Python SDK is async; LangGraph nodes in this project are sync
functions, so `asyncio.run(...)` bridges the two at the edge, once per call.
That's a reasonable place to pay the async/sync tax for a single-user,
one-deal-per-session app — it would need a real event loop if this ever
became a concurrent multi-user service.
"""
import asyncio
import json
import sys
import traceback
from pathlib import Path
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

_SERVER_SCRIPT = str(Path(__file__).resolve().parent.parent / "mcp_server" / "deal_tools_server.py")


def _run_coro(coro):
    """Run an async MCP call from sync code (see module docstring) --
    with one extra wrinkle on Windows.

    Streamlit's web server (Tornado) forces asyncio onto
    WindowsSelectorEventLoopPolicy on Windows for its own compatibility
    reasons. SelectorEventLoop can't launch subprocesses on Windows at all
    ("NotImplementedError"), and our MCP client launches the MCP server as
    a subprocess -- so a plain `asyncio.run(...)` inside a Streamlit app on
    Windows fails, wrapped by the mcp SDK's use of anyio into an
    `ExceptionGroup`. Explicitly constructing a ProactorEventLoop
    sidesteps whatever global policy Tornado has already set, since it
    doesn't go through `get_event_loop_policy()`.
    """
    if sys.platform == "win32":
        loop = asyncio.ProactorEventLoop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()
    return asyncio.run(coro)


async def _call_tool_async(tool_name: str, arguments: dict) -> dict:
    server_params = StdioServerParameters(command=sys.executable, args=[_SERVER_SCRIPT])
    async with AsyncExitStack() as stack:
        read, write = await stack.enter_async_context(stdio_client(server_params))
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        result = await session.call_tool(tool_name, arguments)
        # MCP tool results come back as a list of content blocks; FastMCP
        # returns a dict tool result as a single text block of JSON.
        text = result.content[0].text
        return json.loads(text)


async def _read_resource_async(uri: str) -> str:
    server_params = StdioServerParameters(command=sys.executable, args=[_SERVER_SCRIPT])
    async with AsyncExitStack() as stack:
        read, write = await stack.enter_async_context(stdio_client(server_params))
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        result = await session.read_resource(uri)
        return result.contents[0].text


def _log_mcp_failure(where: str, e: Exception) -> None:
    """Print the real exception to the terminal running Streamlit. The
    caller still degrades gracefully instead of crashing, but a silently
    swallowed exception is impossible to debug remotely -- this makes the
    actual failure (e.g. a Windows subprocess/event-loop error) visible."""
    print(f"\n[mcp_client] {where} failed: {type(e).__name__}: {e}", file=sys.stderr)
    traceback.print_exc()


def get_sde_multiple_benchmark(industry: str) -> dict:
    """Sync wrapper around the MCP `get_sde_multiple_benchmark` tool."""
    try:
        return _run_coro(_call_tool_async("get_sde_multiple_benchmark", {"industry": industry}))
    except Exception as e:
        _log_mcp_failure("get_sde_multiple_benchmark tool call", e)
        # MCP server unreachable/crashed — degrade rather than take down the
        # whole pipeline. diligence_agent treats a missing benchmark as
        # "not stated" rather than guessing a number.
        return {
            "industry_matched": None,
            "matched": False,
            "low": None,
            "typical": None,
            "high": None,
            "source": f"MCP tool call failed ({type(e).__name__}): {e} -- see terminal for full traceback",
        }


def get_red_flag_checklist() -> str:
    """Sync wrapper around the MCP `checklist://red-flags/smb-acquisition` resource."""
    try:
        return _run_coro(_read_resource_async("checklist://red-flags/smb-acquisition"))
    except Exception as e:
        _log_mcp_failure("get_red_flag_checklist resource read", e)
        # Fall back to a minimal inline checklist so diligence can still
        # run (degraded, not dead) if the MCP server can't be reached.
        return (
            "# Red-flag checklist (MCP server unreachable, using fallback)\n"
            f"# error ({type(e).__name__}): {e}\n"
            "1. Customer concentration. 2. Add-back quality. "
            "3. Key-person dependency. 4. Systems & transferability. "
            "5. Price vs. broker claim reconciliation."
        )
