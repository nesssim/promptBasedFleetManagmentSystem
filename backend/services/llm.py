"""LLM service — multi-provider mission planning pipeline.

Phase 1 (Analyst): Natural language → structured plan with flows, constraints, priorities
Phase 2 (DAG Builder): Structured plan → validated JSON DAG

Supports Claude (Anthropic) and Gemini (Google) via a provider abstraction.
Auto-detects which API key is set in environment.
"""

import asyncio
import json
import os
import re
from abc import ABC, abstractmethod
from typing import Any, Optional

import httpx

from ..config import Settings
from .dag_validator import (
    list_locations,
    validate_plan,
    create_task_dag,
)

# ── Shared tool definitions (API-agnostic names) ──

TOOL_DEFS = [
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


# ── Shared helpers ──


def _execute_tool(name: str, args: dict) -> dict:
    """Route tool calls to the appropriate Python function."""
    if name == "list_locations":
        return list_locations()
    elif name == "validate_plan":
        return validate_plan(args.get("plan", {}))
    else:
        raise ValueError(f"Unknown tool: {name}")


def _load_prompt(name: str) -> str:
    """Load a prompt template from the prompts directory."""
    path = os.path.join(PROMPT_DIR, name)
    if not os.path.exists(path):
        return f"You are a fleet mission planner. (prompt {name} not found)"
    with open(path) as f:
        return f.read()


def _load_locations() -> dict:
    """Load locations for prompt context."""
    path = os.path.join(PROMPT_DIR, "..", "data", "locations.json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def _parse_json_response(text: str) -> dict:
    """Extract JSON from LLM text response (may be wrapped in markdown)."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            return json.loads(match.group(1))
        raise ValueError(f"Could not parse LLM response as JSON:\n{text[:500]}")


# ── Provider interface ──


class LLMProvider(ABC):
    """Abstract LLM provider with function-calling support."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name (e.g. 'claude', 'gemini')."""

    @abstractmethod
    async def generate(
        self, system: str, messages: list, max_turns: int = 5
    ) -> str:
        """Run a multi-turn function-calling conversation.

        Args:
            system: System prompt.
            messages: Message history (list of dicts with role/content).
            max_turns: Max function-calling rounds before forcing a final answer.

        Returns:
            The final response text from the LLM.
        """


# ── Claude provider ──


CLAUDE_TOOLS = [
    {
        "name": t["name"],
        "description": t["description"],
        "input_schema": t["input_schema"],
    }
    for t in TOOL_DEFS
]


class ClaudeProvider(LLMProvider):
    """Anthropic Claude provider using the tool-use API."""

    def __init__(self, api_key: str):
        from anthropic import AsyncAnthropic

        self.client = AsyncAnthropic(api_key=api_key)

    @property
    def name(self) -> str:
        return "claude"

    async def generate(
        self, system: str, messages: list, max_turns: int = 5
    ) -> str:
        for attempt in range(3):
            try:
                turn = 0
                while turn < max_turns:
                    response = await asyncio.wait_for(
                        self.client.messages.create(
                            model="claude-3-5-sonnet-20241022",
                            max_tokens=4096,
                            system=system,
                            tools=CLAUDE_TOOLS,
                            tool_choice={"type": "auto"},
                            messages=messages,
                        ),
                        timeout=60.0,
                    )

                    if response.stop_reason == "end_turn":
                        return _text_from_claude(response.content)

                    tool_uses = [
                        c for c in response.content if c.type == "tool_use"
                    ]
                    if not tool_uses:
                        return _text_from_claude(response.content)

                    tool_results = []
                    for tool in tool_uses:
                        result = _execute_tool(tool.name, tool.input)
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
                return _text_from_claude(final.content)

            except asyncio.TimeoutError:
                if attempt >= 2:
                    raise LLMTimeoutError(
                        "LLM call timed out after 60s (3 retries exhausted)"
                    )
                messages.append({
                    "role": "user",
                    "content": (
                        "The previous call timed out. "
                        "Please provide a simpler response."
                    ),
                })
                continue

        raise LLMExhaustedError("LLM failed after all retries")


def _text_from_claude(content: list) -> str:
    """Extract text from Claude response content blocks."""
    return "".join(
        block.text for block in content if hasattr(block, "text") and block.text
    )


# ── Gemini provider ──


GEMINI_TOOLS = [
    {
        "function_declarations": [
            {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            }
            for t in TOOL_DEFS
        ]
    }
]


class GeminiProvider(LLMProvider):
    """Google Gemini provider using function-calling."""

    def __init__(self, api_key: str):
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        configured = os.environ.get("GOOGLE_GEMINI_MODEL", "")
        self._fallbacks = ["gemini-flash-latest", "gemini-1.5-flash", "gemini-1.5-flash-8b"]
        if configured:
            self._fallbacks.insert(0, configured)
        self._model_idx = 0
        self._genai = genai

    @property
    def name(self) -> str:
        return "gemini"

    def _model(self):
        return self._genai.GenerativeModel(
            model_name=self._fallbacks[self._model_idx],
            system_instruction=self._system,
            tools=GEMINI_TOOLS,
        )

    def _try_next_model(self) -> bool:
        """Advance to next fallback model. Returns False if exhausted."""
        if self._model_idx + 1 < len(self._fallbacks):
            self._model_idx += 1
            return True
        return False

    async def generate(
        self, system: str, messages: list, max_turns: int = 5
    ) -> str:
        self._system = system
        contents = _to_gemini_contents(messages)
        last_error = None

        # Outer loop: try each model fallback
        while True:
            model = self._model()
            try:
                return await self._generate_with_model(model, contents, max_turns)
            except Exception as e:
                err_str = str(e).lower()
                is_model_error = "not found" in err_str or "not supported" in err_str or "404" in err_str
                if is_model_error and self._try_next_model():
                    last_error = e
                    continue
                if last_error:
                    raise LLMExhaustedError(
                        f"Gemini failed with all models. Last error: {last_error}"
                    ) from e
                raise

    async def _generate_with_model(
        self, model, contents: list, max_turns: int
    ) -> str:
        for attempt in range(3):
            try:
                turn = 0
                while turn < max_turns:
                    response = await asyncio.wait_for(
                        model.generate_content_async(contents),
                        timeout=60.0,
                    )

                    if not response.candidates:
                        raise ValueError("Gemini returned empty response")

                    candidate = response.candidates[0]
                    fc_parts = [
                        p for p in candidate.content.parts
                        if hasattr(p, "function_call") and p.function_call
                    ]

                    if not fc_parts:
                        return "".join(
                            p.text for p in candidate.content.parts
                            if hasattr(p, "text") and p.text
                        )

                    # Append assistant response with function calls
                    contents.append(candidate.content)

                    for part in fc_parts:
                        fc = part.function_call
                        args = dict(fc.args.items()) if fc.args else {}
                        result = _execute_tool(fc.name, args)
                        contents.append({
                            "role": "function",
                            "parts": [{
                                "function_response": {
                                    "name": fc.name,
                                    "response": {"result": result},
                                }
                            }],
                        })
                    turn += 1

                # Max turns reached — force conclusion
                contents.append({
                    "role": "user",
                    "parts": [{"text": "Please provide your final answer now."}],
                })
                final = await asyncio.wait_for(
                    model.generate_content_async(contents),
                    timeout=60.0,
                )
                return "".join(
                    p.text for p in final.candidates[0].content.parts
                    if hasattr(p, "text") and p.text
                )

            except asyncio.TimeoutError:
                if attempt >= 2:
                    raise LLMTimeoutError(
                        "LLM call timed out after 60s (3 retries exhausted)"
                    )
                contents.append({
                    "role": "user",
                    "parts": [{"text": "The previous call timed out. Please provide a simpler response."}],
                })
                continue
            except Exception as e:
                if attempt >= 2:
                    raise
                err_str = str(e).lower()
                is_overload = any(w in err_str for w in ["503", "unavailable", "overloaded", "high demand", "resource exhausted"])
                if is_overload:
                    wait = 2 ** attempt
                    await asyncio.sleep(wait)
                    continue
                contents.append({
                    "role": "user",
                    "parts": [{"text": f"The previous call failed: {e}. Please provide a simpler response."}],
                })
                continue

        raise LLMExhaustedError("LLM failed after all retries")


def _to_gemini_contents(messages: list) -> list:
    """Convert generic message list to Gemini contents format."""
    contents = []
    role_map = {"assistant": "model", "user": "user"}
    for msg in messages:
        role = role_map.get(msg.get("role", "user"), "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    t = item.get("type", "")
                    if t == "tool_result":
                        parts.append({
                            "function_response": {
                                "name": item.get("tool_use_id", ""),
                                "response": {"result": item.get("content", "")},
                            },
                        })
                    else:
                        parts.append({"text": str(item)})
                else:
                    parts.append({"text": str(item)})
            contents.append({"role": role, "parts": parts})
        else:
            contents.append({"role": role, "parts": [{"text": content}]})
    return contents


# ── Local provider (OpenAI-compatible API) ──


def _adapt_for_local(system: str) -> str:
    """Reinforce location-only rule for local models.

    Local models struggle with tool-use instructions, so we add
    a strict reminder at the end of the prompt.
    """
    adapted = system.rstrip()
    adapted += (
        "\n\n## Strict Rules\n"
        "- Return ONLY a valid JSON object. No markdown, no code fences, no extra text.\n"
        "- Use EXACTLY the location names from the list below. Never invent new ones.\n"
        "- Do NOT add charging stations or extra zones unless the user explicitly requests them.\n"
    )
    return adapted


def _flatten_messages(messages: list) -> list:
    """Convert generic messages to OpenAI-format, stripping tool internals."""
    out = []
    for msg in messages:
        role = msg.get("role", "user")
        if role == "assistant":
            out.append({"role": "assistant", "content": msg.get("content", "")})
            continue
        content = msg.get("content", "")
        if isinstance(content, list):
            texts = []
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "tool_result":
                        texts.append(f"Tool returned: {item.get('content', '')}")
                    elif "text" in item:
                        texts.append(str(item["text"]))
                    else:
                        texts.append(str(item))
                else:
                    texts.append(str(item))
            content = "\n".join(texts)
        out.append({"role": "user", "content": content})
    return out


class LocalProvider(LLMProvider):
    """Local LLM via OpenAI-compatible API (LM Studio, Ollama, etc.)."""

    def __init__(self, api_url: str, model: str = ""):
        self.api_url = api_url.rstrip("/")
        self.model = model or None

    @property
    def name(self) -> str:
        return "local"

    async def generate(
        self, system: str, messages: list, max_turns: int = 5
    ) -> str:
        system = _adapt_for_local(system)
        oai_messages = [{"role": "system", "content": system}]
        oai_messages.extend(_flatten_messages(messages))

        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    body = {
                        "messages": oai_messages,
                        "max_tokens": 4096,
                        "temperature": 0.2,
                    }
                    if self.model:
                        body["model"] = self.model
                    resp = await client.post(
                        f"{self.api_url}/chat/completions",
                        json=body,
                    )
                    if resp.status_code == 503:
                        await asyncio.sleep(2**attempt)
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    # LM Studio Qwen models may return reasoning_content alongside content
                    msg = data["choices"][0].get("message", {})
                    content = msg.get("content") or ""
                    if not content.strip():
                        # Some models put output in reasoning_content
                        content = msg.get("reasoning_content", "")
                    return content
            except asyncio.CancelledError:
                # Uvicorn reload or shutdown — re-raise so FastAPI handles it cleanly
                raise
            except httpx.TimeoutException:
                if attempt >= 2:
                    raise LLMTimeoutError("Local LLM timed out after 3 retries")
                continue
            except Exception as e:
                logger.warning("Local LLM attempt %d/3 failed: %s", attempt + 1, e)
                if attempt >= 2:
                    raise LLMExhaustedError(
                        f"Local LLM failed after 3 retries: {e}"
                    ) from e
                await asyncio.sleep(1)
                continue

        raise LLMExhaustedError("Local LLM failed after all retries")


# ── LLMService: orchestrator ──


class LLMService:
    """Orchestrates the two-phase LLM mission planning pipeline.

    Auto-selects provider based on available API key:
    - ANTHROPIC_API_KEY → Claude
    - GOOGLE_API_KEY → Gemini
    - Neither → None (handled by caller for mock mode)
    """

    def __init__(self, settings: Settings):
        if settings.anthropic_api_key:
            self._provider: LLMProvider = ClaudeProvider(settings.anthropic_api_key)
        elif settings.google_api_key:
            self._provider = GeminiProvider(settings.google_api_key)
        elif settings.local_llm_url:
            self._provider = LocalProvider(settings.local_llm_url, settings.local_llm_model)
        else:
            self._provider = None

    @property
    def provider_name(self) -> str:
        return self._provider.name if self._provider else "mock"

    # ── Phase 1: Analyst ──

    async def phase1_analyst(
        self,
        mission: str,
        robot_count: int,
        history: Optional[list] = None,
    ) -> dict:
        """Natural language → structured plan."""
        system = _load_prompt("phase1_analyst.txt")
        locations = json.dumps(_load_locations(), indent=2)

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

        text = await self._provider.generate(system, messages)
        return _parse_json_response(text)

    # ── Phase 2: DAG Builder ──

    async def phase2_dag(self, plan: dict, robot_count: int) -> dict:
        """Structured plan → validated JSON DAG."""
        system = _load_prompt("phase2_dag.txt")

        messages = [{
            "role": "user",
            "content": (
                f"Plan from Phase 1:\n{json.dumps(plan, indent=2)}\n\n"
                f"Robots available: {robot_count}\n\n"
                "Generate a complete JSON DAG for this mission."
            ),
        }]

        text = await self._provider.generate(system, messages)
        raw_dag = _parse_json_response(text)
        return create_task_dag(raw_dag)

    # ── Correction ──

    async def correct_plan(
        self,
        correction: str,
        robot_count: int,
        history: list,
    ) -> dict:
        """Applies a correction to the current plan."""
        system = _load_prompt("phase1_analyst.txt")

        messages = list(history)
        messages.append({
            "role": "user",
            "content": f"Revise the plan based on this correction: {correction}",
        })

        text = await self._provider.generate(system, messages)
        return _parse_json_response(text)
