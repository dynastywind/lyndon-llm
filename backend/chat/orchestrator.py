"""
Chat message orchestrator — decides whether to pre-fetch RAG, use tools, or
stream directly to the model before each turn.

Two strategies are available, selected by ``settings.orchestrator_strategy``:

  • ``llm`` (default) — the user query first goes to the model, which classifies
    its intent (casual / factual / complex / documents). The classification is
    mapped onto the same RouteDecision the heuristic produces, so every
    downstream path (direct stream, web-search fast path, planner) is reused.
    Any classifier failure falls back to the heuristic so chat never breaks.
  • ``heuristic`` — fast regex routing, no extra LLM call. Also the fallback.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
import re
from typing import Literal, Protocol

from config.settings import settings
from core.llm.gateway import LLMMessage, llm_gateway

logger = logging.getLogger(__name__)

RouteName = Literal["direct", "rag", "tools", "rag_and_tools", "plan"]

# Sentinel added to tool_set when the user explicitly invokes a skill.
# The engine expands it to the actual registered skill tool names at request time.
SKILL_SIGNAL = "__skill__"

ALL_CHAT_TOOLS = frozenset({"web_search", "rag_query", "render_chart", "run_code", SKILL_SIGNAL})

# Greeting / short chit-chat with no other signals
_GREETING_RE = re.compile(
    r"^(hi|hello|hey|thanks|thank you|bye|goodbye|good morning|good night)\b",
    re.IGNORECASE,
)

# Knowledge-base / uploaded document language
_RAG_SIGNAL_RE = re.compile(
    r"\b("
    r"document|documents|uploaded|ingested|knowledge\s+base|"
    r"my\s+(file|files|pdf|pdfs|notes|doc|docs|document|documents)|"
    r"according\s+to|in\s+my\s+(files?|docs?|notes|library)|"
    r"from\s+(the\s+)?(file|pdf|document|upload)|"
    r"financial\s+report|"
    r"\.pdf\b|\.md\b|\.txt\b|\.docx?\b"
    r")\b",
    re.IGNORECASE,
)

# Explicit mention of documents even when KB is empty
_EXPLICIT_DOC_RE = re.compile(
    r"\b(uploaded|my\s+(pdf|file|document)|knowledge\s+base)\b",
    re.IGNORECASE,
)

# Real-time / web search signals
# Note: "today" / "tonight" intentionally excluded — date-only questions
# ("what's today's date?") don't need a web search and DuckDuckGo returns
# stale cached page dates.  Queries that genuinely need live data already
# match on their own keywords (weather, news, score, etc.).
_WEB_SEARCH_RE = re.compile(
    r"\b("
    r"right\s+now|currently|current|latest|recent|"
    r"weather|forecast|news|headline|score|scores|"
    r"price\s+of|stock\s+price|exchange\s+rate|"
    r"this\s+week|this\s+month|this\s+year|"
    r"live\s+(score|update|results?)"
    r")\b",
    re.IGNORECASE,
)

# Chart / visualization signals
_CHART_RE = re.compile(
    r"\b(chart|graph|plot|visuali[sz]e|visuali[sz]ation|diagram)\b",
    re.IGNORECASE,
)

# Multi-step / sequential language
_PLAN_SEQUENTIAL_RE = re.compile(
    r"\b(first[,\s].+then|step[\s-]by[\s-]step|"
    r"and\s+then|after\s+that|following\s+that|"
    r"in\s+order|one\s+by\s+one)\b",
    re.IGNORECASE | re.DOTALL,
)

# Explicit planning request
_PLAN_EXPLICIT_RE = re.compile(
    r"\b(plan|workflow|break\s+(it\s+)?down|"
    r"create\s+a\s+plan|make\s+a\s+plan|"
    r"outline|roadmap|steps?\s+to)\b",
    re.IGNORECASE,
)

# Comparative / research / multi-source analysis
_PLAN_RESEARCH_RE = re.compile(
    r"\b(compare|comparison|analyze|analyse|analysis|"
    r"research|investigate|deep\s+dive|comprehensive|"
    r"pros?\s+and\s+cons?|evaluate|assessment)\b",
    re.IGNORECASE,
)

# Skills meta-query — user wants to LIST / inspect installed skills
_SKILLS_LIST_RE = re.compile(
    r"\b("
    r"what\s+skills?|list\s+(my\s+)?skills?|show\s+(me\s+)?(my\s+)?skills?|"
    r"do\s+i\s+have\s+(any\s+)?skills?|available\s+skills?|"
    r"what\s+tools?\s+do\s+(i|you)\s+have|installed\s+(skill|skills|tool|tools|plugin|plugins)"
    r")\b",
    re.IGNORECASE,
)

# Skill invocation — user wants to USE a skill tool
_SKILLS_RE = re.compile(
    r"\b(skill|skills|my\s+(tool|tools))\b",
    re.IGNORECASE,
)

# Code-execution signals — any request to run / execute / test a snippet
_LANGS = (
    r"python|javascript|js|typescript|ts|ruby|go|golang|rust|java|"
    r"c\+\+|cpp|c#|csharp|c\b|bash|shell|haskell|ocaml|erlang|elixir|"
    r"kotlin|scala|clojure|dart|swift|php|perl|lua|groovy|r\b"
)
_CODE_EXEC_RE = re.compile(
    r"("
    # "run/execute/test this code", "run this python code", "run the following script", etc.
    # (\w+\s+)? allows an optional language word between the determiner and noun
    r"\b(run|execute|eval|test)\s+(this|the|following|my|above)\s+(?:\w+\s+){0,2}"
    r"(code|snippet|script|program|function|example)\b|"
    # "run python code", "execute javascript", "compile and run"
    r"\b(run|execute)\s+(" + _LANGS + r")(\s+(code|snippet|script|program))?\b|"
    r"\bcompile\s+(and\s+run|this)\b|"
    # "what does/will this code output/return/print"
    r"\bwhat\s+(does|will|would|is)\s+(this|the|it)\s+(code\s+)?(output|return|print|produce|do)\b|"
    # "what's the output of", "what is the output"
    r"\bwhat['’]?s\s+the\s+output\b|"
    r"\bwhat\s+is\s+the\s+(output|result)\s+of\b"
    r")",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RouteDecision:
    route: RouteName
    tools: frozenset[str]
    reason: str

    @property
    def needs_rag(self) -> bool:
        return self.route in ("rag", "rag_and_tools")

    @property
    def needs_tools(self) -> bool:
        return self.route in ("tools", "rag_and_tools")

    @property
    def needs_plan(self) -> bool:
        return self.route == "plan"


class Orchestrator(Protocol):
    async def route(self, message: str, *, has_kb_sources: bool) -> RouteDecision: ...


class HeuristicOrchestrator:
    """Rule-based routing — fast, no extra LLM call."""

    async def route(self, message: str, *, has_kb_sources: bool) -> RouteDecision:
        text = (message or "").strip()
        if not text:
            return RouteDecision("direct", frozenset(), "empty message")

        wants_rag = _wants_rag(text, has_kb_sources)
        tool_set: set[str] = set()

        if _WEB_SEARCH_RE.search(text):
            tool_set.add("web_search")
        if _CHART_RE.search(text):
            tool_set.add("render_chart")
        if _CODE_EXEC_RE.search(text):
            tool_set.add("run_code")
        if _SKILLS_LIST_RE.search(text):
            tool_set.add("list_skills")
        elif _SKILLS_RE.search(text):
            tool_set.add(SKILL_SIGNAL)

        # Allow on-demand KB search mid-turn when tools are active and KB exists.
        # Skip for list_skills — it's a deterministic meta-query that doesn't
        # benefit from RAG and the extra tool breaks the fast-path exact-match.
        if tool_set and has_kb_sources and not wants_rag and "list_skills" not in tool_set:
            tool_set.add("rag_query")

        # Planning — checked before routing to tool / rag paths.
        # Include rag_query in the effective tool count when wants_rag is true,
        # since it will be added to the tool set by the rag_and_tools branch.
        effective_tools = tool_set | ({"rag_query"} if wants_rag else set())
        if settings.planner_enabled and len(text) >= 30 and _is_complex(
            text, effective_tools, settings.planner_complexity_threshold
        ):
            return RouteDecision("plan", frozenset(tool_set), "complexity signal: planning required")

        # Greeting-only short messages with no other signals
        if not wants_rag and not tool_set and len(text) < 20 and _GREETING_RE.match(text):
            return RouteDecision("direct", frozenset(), "greeting")

        if wants_rag and tool_set:
            if has_kb_sources:
                tool_set.add("rag_query")
            return RouteDecision(
                "rag_and_tools",
                frozenset(tool_set),
                "rag and tool signals",
            )
        if wants_rag:
            return RouteDecision("rag", frozenset(), "rag signal")
        if tool_set:
            return RouteDecision(
                "tools",
                frozenset(tool_set),
                "tool signal: " + ", ".join(sorted(tool_set)),
            )

        return RouteDecision("direct", frozenset(), "no signals")


def _is_complex(text: str, tool_set: set[str], threshold: int = 2) -> bool:
    """Return True when the message warrants a structured plan.

    Uses a weighted signal count: explicit planning language scores +2 on its
    own (strong signal); all other signals score +1 each.
    """
    score = 0
    if _PLAN_SEQUENTIAL_RE.search(text):
        score += 1
    if _PLAN_EXPLICIT_RE.search(text):
        score += 2
    if _PLAN_RESEARCH_RE.search(text):
        score += 1
    if len(tool_set) >= 2:
        score += 1
    return score >= threshold


def _wants_rag(text: str, has_kb_sources: bool) -> bool:
    if not _RAG_SIGNAL_RE.search(text):
        return False
    if has_kb_sources:
        return True
    return bool(_EXPLICIT_DOC_RE.search(text))


# Base classifier instruction. The {documents_option} placeholder is filled with
# an extra intent line only when the knowledge base has ingested sources, so the
# model is never offered "documents" when there is nothing to search.
_INTENT_SYSTEM = """\
You are an intent classifier for a chat assistant. Read the user's message and
decide which single category best describes what they want.

Categories:
  casual  — greetings, small talk, opinions, or general-knowledge questions the
            assistant can answer directly from what it already knows.
  factual — questions needing CURRENT or real-time external information: live
            news, today's weather, current prices, scores, recent releases.
            These require a web search.
  complex — multi-step tasks that need a plan: research-and-compare, "first X
            then Y", build/produce something from several steps, or any request
            that combines multiple tools or sub-tasks.{documents_option}

Output ONLY valid JSON, no markdown, no explanation:
{{"intent": "<category>", "reason": "<short justification>"}}
"""

_DOCUMENTS_OPTION = """
  documents — questions about the user's OWN uploaded files / documents /
            knowledge base ("according to my report", "summarize my notes")."""

_VALID_INTENTS = {"casual", "factual", "complex", "documents"}


class LLMOrchestrator:
    """Model-driven router — the query is classified by the LLM, then mapped onto
    the same RouteDecision the heuristic produces. Falls back to the heuristic on
    any failure so chat never breaks."""

    def __init__(self) -> None:
        self._fallback = HeuristicOrchestrator()

    async def route(self, message: str, *, has_kb_sources: bool) -> RouteDecision:
        text = (message or "").strip()
        if not text:
            return RouteDecision("direct", frozenset(), "empty message")

        try:
            intent, reason = await self._classify(text, has_kb_sources=has_kb_sources)
        except Exception as e:  # timeout, JSON error, connection failure, etc.
            logger.warning("LLM intent classification failed (%s); using heuristic", e)
            return await self._fallback.route(text, has_kb_sources=has_kb_sources)

        return await self._map_intent(intent, reason, text, has_kb_sources=has_kb_sources)

    async def _classify(self, text: str, *, has_kb_sources: bool) -> tuple[str, str]:
        system = _INTENT_SYSTEM.format(
            documents_option=_DOCUMENTS_OPTION if has_kb_sources else ""
        )
        response, _usage = await asyncio.wait_for(
            llm_gateway.complete(
                messages=[LLMMessage("system", system), LLMMessage("user", text)],
                temperature=0.0,
                max_tokens=120,
            ),
            timeout=settings.orchestrator_llm_timeout,
        )
        cleaned = (
            response.strip()
            .removeprefix("```json")
            .removeprefix("```")
            .removesuffix("```")
            .strip()
        )
        data = json.loads(cleaned)
        intent = str(data.get("intent", "")).strip().lower()
        if intent not in _VALID_INTENTS:
            raise ValueError(f"unknown intent: {intent!r}")
        return intent, str(data.get("reason", "")).strip()

    async def _map_intent(
        self, intent: str, reason: str, text: str, *, has_kb_sources: bool
    ) -> RouteDecision:
        why = f"llm intent: {intent}" + (f" — {reason}" if reason else "")

        if intent == "factual":
            # Single-tool set so the engine takes the web-search fast path.
            return RouteDecision("tools", frozenset({"web_search"}), why)

        if intent == "complex":
            if settings.planner_enabled:
                return RouteDecision("plan", frozenset(), why)
            # Planner disabled — don't strand the query; let the heuristic decide.
            logger.info("planner disabled; routing 'complex' intent via heuristic")
            return await self._fallback.route(text, has_kb_sources=has_kb_sources)

        if intent == "documents" and has_kb_sources:
            return RouteDecision("rag", frozenset(), why)

        # casual (and documents without a KB) → direct answer
        return RouteDecision("direct", frozenset(), why)


def get_orchestrator() -> Orchestrator:
    if settings.orchestrator_strategy == "llm":
        return LLMOrchestrator()
    return HeuristicOrchestrator()


async def kb_has_sources(user_id: str | None = None) -> bool:
    """Return True if the RAG knowledge base has at least one ingested source.

    ChromaVectorStore.list_sources() calls chromadb synchronously (blocking I/O).
    Run it in a thread pool executor so a slow or absent Chroma server never
    stalls the async event loop.  A 3-second timeout ensures we fail fast.
    """
    import asyncio

    try:
        from chat.rag.retriever import HybridRetriever
        from db.vector.store import get_vector_store

        store = await get_vector_store(HybridRetriever.COLLECTION_NAME)

        # list_sources() is `async def` but its internals are synchronous Chroma /
        # Qdrant calls — off-load to a thread so blocking I/O can't freeze the loop.
        def _sync_list():
            import asyncio as _aio

            return _aio.run(store.list_sources(user_id=user_id))

        loop = asyncio.get_running_loop()
        sources = await asyncio.wait_for(
            loop.run_in_executor(None, _sync_list),
            timeout=3,
        )
        return len(sources) > 0
    except Exception:
        return False


def legacy_route_decision() -> RouteDecision:
    """Always-on RAG + full tool loop (orchestrator disabled)."""
    return RouteDecision(
        "rag_and_tools",
        ALL_CHAT_TOOLS,
        "orchestrator disabled",
    )
