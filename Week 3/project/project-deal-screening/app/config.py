"""
Central config: loads API keys and model names from .env.

Nothing here should ever contain an actual key — those live only in your
local .env file (which is gitignored and never committed).
"""
import os
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

if not ANTHROPIC_API_KEY:
    raise RuntimeError(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key."
    )

# Per-agent model overrides (see PROJECT_FRAMEWORK.md for why these are separate
# agents rather than one big prompt).
EXTRACTION_MODEL = os.getenv("EXTRACTION_MODEL", "claude-sonnet-4-5")
DILIGENCE_MODEL = os.getenv("DILIGENCE_MODEL", "claude-sonnet-4-5")
SYNTHESIS_MODEL = os.getenv("SYNTHESIS_MODEL", "claude-sonnet-4-5")
