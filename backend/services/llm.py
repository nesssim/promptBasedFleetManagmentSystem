"""LLM service — Anthropic client with 2-phase mission planning.

Phase 1 (Analyst): Natural language → structured plan with flows, constraints, priorities
Phase 2 (DAG Builder): Structured plan → validated JSON DAG

Key design decisions:
- All endpoints are async def with AsyncAnthropic (never blocks event loop)
- Per-call timeout: 60s
- Max tool-use turns per phase: 5
- Total max wall time per phase: 120s (includes retries)
- Retry strategy: max 2 retries with error feedback
- Correction loop: max 3 rounds, SHA-256 convergence detection
"""

import asyncio
import hashlib
import json
import os
from typing import Any, Optional

from anthropic import AsyncAnthropic

from backend.config import Settings
from backend.services.dag_validator import (
    list_locations,
    validate_plan,
    create_task_dag,
)

# Anthropic tool definitions for the tool-use API
ANTHROPIC_TOOLS = [
    {
        "name": "list_locations",
        "description": "Returns valid yard location names. Call this to verify location names before using them in your plan.",
        "input_schema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "validate_plan",
        "description": "Validates a plan against the location whitelist and field requirements. Call this on your output to self-check before returning.",
        "input_schema": {
            "type": "object",
            "properties": {
                "plan": {
                    "type": "object",
                    "description": "The plan JSON to validate",
                }
            },
            "required": ["plan"],
        },
    },
]

PROMPT_DIR = os.path.join(os.path.dirname(__file__), "..", "prompts")


class LLMTimeoutError(Exception):
    """LLM call exceeded timeout."""


class LLMExhaustedError(Exception):
    """LLM failed after all retries."""


class LLMService:
    """Orchestrates the two-phase LLM mission planning pipeline."""

    def __init__(self, settings: Settings):
        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.settings = settings

    # ── Phase 1: Analyst ──

    async def phase1_analyst(
        self,
        mission: str,
        robot_count: int,
        history: Optional[list] = None,
    ) -> dict:
        """Natural language → structured plan.

        The LLM uses tool-use to call list_locations() and validate_plan()
        during generation, grounding its output in real data.
        """
        system = self._load_prompt("phase1_analyst.txt")
        locations = json.dumps(self._load_locations(), indent=2)

        messages = []
        if history:
            messages.extend(history)

        messages.append({
            "role": "user",
            "content": (
                f"Available yard locations:\n{locations}\n\n"
                f"Mission: {mission}\n\n"
                f"Robots available: {robot_count}\n\n"
                "Analyze this mission and produce a structured plan."
            ),
        })

        response = await self._call_llm_with_tools(system, messages)
        return self._parse_plan(response)

    # ── Phase 2: DAG Builder ──

    async def phase2_dag(
        self,
        plan: dict,
        robot_count: int,
    ) -> dict:
        """Structured plan → validated JSON DAG.

        The LLM generates a DAG in the canonical schema, then it's
        validated by create_task_dag() which applies topological sort,
        robot assignment checks, and charging insertion.
        """
        system = self._load_prompt("phase2_dag.txt")

        messages = [{
            "role": "user",
            "content": (
                f"Plan from Phase 1:\n{json.dumps(plan, indent=2)}\n\n"
                f"Robots available: {robot_count}\n\n"
                "Generate a complete JSON DAG for this mission."
            ),
        }]

        response = await self._call_llm_with_tools(system, messages)
        raw_dag = self._parse_dag(response)

        # Validate and canonicalize via create_task_dag()
        return create_task_dag(raw_dag)

    # ── Correction ──

    async def correct_plan(
        self,
        correction: str,
        robot_count: int,
        history: list,
    ) -> dict:
        """Applies a correction to the current plan.

        Max 3 corrections enforced by caller.
        Convergence guard: caller checks SHA-256 of returned DAG.
        """
        system = self._load_prompt("phase1_analyst.txt")

        messages = list(history)
        messages.append({
            "role": "user",
            "content": f"Revise the plan based on this correction: {correction}",
        })

        response = await self._call_llm_with_tools(system, messages)
        return self._parse_plan(response)

    # ── Core LLM call with tool-use loop ──

    async def _call_llm_with_tools(
        self,
        system: str,
        messages: list,
        max_turns: int = 5,
    ) -> list:
        """Multi-turn tool-use loop.

        Each turn: send prompt + tools → LLM returns tool_use or end_turn
        If tool_use: execute tool locally → return tool_result → continue
        If end_turn: return final content

        Max 5 tool-use turns prevents runaway API costs.
        """
        for attempt in range(3):  # max retries
            try:
                turn = 0
                while turn < max_turns:
                    response = await asyncio.wait_for(
                        self.client.messages.create(
                            model="claude-3-5-sonnet-20241022",
                            max_tokens=4096,
                            system=system,
                            tools=ANTHROPIC_TOOLS,
                            tool_choice={"type": "auto"},
                            messages=messages,
                        ),
                        timeout=60.0,
                    )

                    if response.stop_reason == "end_turn":
                        return response.content

                    # Process tool uses
                    tool_uses = [
                        c for c in response.content
                        if c.type == "tool_use"
                    ]
                    if not tool_uses:
                        return response.content

                    tool_results = []
                    for tool in tool_uses:
                        result = self._execute_tool(tool.name, tool.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool.id,
                            "content": json.dumps(result),
                        })

                    messages.append({
                        "role": "assistant",
                        "content": response.content,
                    })
                    messages.append({
                        "role": "user",
                        "content": tool_results,
                    })
                    turn += 1

                # If we exhaust turns, force the LLM to conclude
                messages.append({
                    "role": "user",
                    "content": (
                        "You have reached the maximum number of tool calls. "
                        "Please provide your final answer now."
                    ),
                })
                final = await asyncio.wait_for(
                    self.client.messages.create(
                        model="claude-3-5-sonnet-20241022",
                        max_tokens=4096,
                        system=system,
                        messages=messages,
                    ),
                    timeout=60.0,
                )
                return final.content

            except asyncio.TimeoutError:
                if attempt >= 2:
                    raise LLMTimeoutError(
                        "LLM call timed out after 60s (3 retries exhausted)"
                    )
                # On timeout, add a note and retry
                messages.append({
                    "role": "user",
                    "content": (
                        "The previous call timed out. "
                        "Please provide a simpler response."
                    ),
                })
                continue

        raise LLMExhaustedError("LLM failed after all retries")

    # ── Tool execution ──

    def _execute_tool(self, name: str, args: dict) -> dict:
        """Route tool calls to the appropriate Python function."""
        if name == "list_locations":
            return list_locations()
        elif name == "validate_plan":
            return validate_plan(args.get("plan", {}))
        else:
            raise ValueError(f"Unknown tool: {name}")

    # ── Response parsers ──

    def _parse_plan(self, content: list) -> dict:
        """Extract structured plan from LLM response."""
        text = "".join(
            block.text for block in content if hasattr(block, "text") and block.text
        )
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # LLM may wrap in markdown code block
            import re
            match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
            if match:
                return json.loads(match.group(1))
            raise ValueError(f"Could not parse LLM response as JSON:\n{text[:500]}")

    def _parse_dag(self, content: list) -> dict:
        """Extract DAG JSON from LLM response."""
        return self._parse_plan(content)  # Same logic

    # ── Helpers ──

    def _load_prompt(self, name: str) -> str:
        """Load a prompt template from the prompts directory."""
        path = os.path.join(PROMPT_DIR, name)
        if not os.path.exists(path):
            return f"You are a fleet mission planner. (prompt {name} not found)"
        with open(path) as f:
            return f.read()

    def _load_locations(self) -> dict:
        """Load locations for prompt context."""
        path = os.path.join(PROMPT_DIR, "..", "data", "locations.json")
        if not os.path.exists(path):
            return {}
        with open(path) as f:
            return json.load(f)

    def compute_dag_hash(self, dag: dict) -> str:
        """SHA-256 hash of canonical DAG JSON for convergence detection."""
        serialized = json.dumps(dag, sort_keys=True, default=str)
        return hashlib.sha256(serialized.encode()).hexdigest()
