"""
RenderChart tool — generates a chart spec that the frontend renders via Recharts.

The tool itself does no rendering; it validates the spec and returns it as a
JSON payload that the engine detects and forwards as a `chart` SSE event.

Supported chart types:  bar | line | area | pie
"""
from __future__ import annotations

import json
from typing import Any

from core.permissions.gate import Permission
from core.tools.base import BaseTool, ToolResult
from core.permissions.gate import require_permission

# Sentinel key used by the engine to identify chart results
CHART_SPEC_KEY = "__chart_spec__"

VALID_TYPES = ("bar", "line", "area", "pie")


class RenderChartTool(BaseTool):
    name = "render_chart"
    description = (
        "Render a chart or graph visible to the user. "
        "Call this when the user asks for any data visualization. "
        "You must supply the complete dataset, chart type, and series config. "
        "Supported types: bar, line, area, pie."
    )
    permission = Permission.READ

    @require_permission(Permission.READ)
    async def run(                             # type: ignore[override]
        self,
        type: str,
        title: str,
        x_key: str,
        data: list[dict],
        series: list[dict] | None = None,
    ) -> ToolResult:
        # ── Validation ───────────────────────────────────────────────────
        if type not in VALID_TYPES:
            return ToolResult(
                tool_name=self.name, success=False, output=None,
                error=f"Invalid chart type '{type}'. Must be one of: {', '.join(VALID_TYPES)}",
            )
        if not data:
            return ToolResult(
                tool_name=self.name, success=False, output=None,
                error="'data' must be a non-empty array of objects.",
            )

        # Auto-detect series from data keys when not supplied
        effective_series: list[dict] = series or []
        if not effective_series:
            sample = data[0] if data else {}
            effective_series = [{"key": k} for k in sample if k != x_key]

        spec = {
            "type": type,
            "title": title,
            "x_key": x_key,
            "data": data,
            "series": effective_series,
        }

        # Wrap in sentinel so the engine can detect and route it as a chart event
        return ToolResult(
            tool_name=self.name,
            success=True,
            output=json.dumps({CHART_SPEC_KEY: spec}),
        )

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": list(VALID_TYPES),
                        "description": "Chart type: bar, line, area, or pie.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Human-readable chart title.",
                    },
                    "x_key": {
                        "type": "string",
                        "description": (
                            "The key in each data object used for the X axis / labels. "
                            "For pie charts this is the slice name key."
                        ),
                    },
                    "data": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": (
                            "Array of data objects. Each object must contain the x_key "
                            "and one key per series. "
                            "Example: [{\"month\": \"Jan\", \"sales\": 120, \"costs\": 80}, ...]"
                        ),
                    },
                    "series": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "key":   {"type": "string", "description": "Data key to plot."},
                                "name":  {"type": "string", "description": "Display label (optional)."},
                                "color": {"type": "string", "description": "Hex colour (optional)."},
                            },
                            "required": ["key"],
                        },
                        "description": (
                            "Series to plot. If omitted, all keys except x_key are used. "
                            "Example: [{\"key\": \"sales\", \"name\": \"Sales\", \"color\": \"#6366f1\"}]"
                        ),
                    },
                },
                "required": ["type", "title", "x_key", "data"],
            },
        }
