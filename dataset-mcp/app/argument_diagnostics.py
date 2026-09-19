"""Temporary, value-free tracing of map argument types at two boundaries."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from typing import Literal
from uuid import uuid4

from fastmcp.server.dependencies import get_http_request
from fastmcp.server.middleware import CallNext, Middleware, MiddlewareContext
from fastmcp.tools import ToolResult
from mcp.types import CallToolRequestParams
from pydantic import JsonValue, TypeAdapter, ValidationError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

LOGGER = logging.getLogger("uvicorn.error.argument_diagnostics")
REQUEST_ID_KEY = "hifld.argument_diagnostics.request_id"
MAX_CAPTURE_BYTES = 1024 * 1024
_JSON = TypeAdapter[JsonValue](JsonValue)


def _value_type(value: object) -> str:
    """Accept unknown values only at the JSON/tool boundary; never stringify them."""
    if value is None:
        return "null"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "other"


def _emit(
    stage: Literal["http_ingress", "tool_dispatch"],
    request_id: str,
    arguments: Mapping[str, object],
) -> None:
    LOGGER.info(
        json.dumps(
            {
                "event": "mcp_argument_types",
                "stage": stage,
                "request_id": request_id,
                "revision": os.environ.get("DATASET_MCP_BUILD_REVISION", "unknown"),
                "tool": "view_query_map",
                **{
                    f"{key}_type": _value_type(arguments[key]) if key in arguments else "missing"
                    for key in ("layers", "camera")
                },
            },
            separators=(",", ":"),
        )
    )


class ArgumentIngressDiagnostics:
    """Tee ASGI receive messages unchanged; never pre-read or replay the body.

    Diagnostic capture is capped independently of normal request processing.
    Invalid/oversized JSON is left entirely to the existing transport validator.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method") != "POST"
            or scope.get("path") not in ("/mcp", "/mcp/")
        ):
            await self.app(scope, receive, send)
            return
        request_id = uuid4().hex
        scope[REQUEST_ID_KEY] = request_id
        captured = bytearray()
        done = False

        async def observe_receive() -> Message:
            nonlocal done
            message = await receive()
            if not done and message["type"] == "http.request":
                chunk = message.get("body", b"")
                if len(captured) + len(chunk) > MAX_CAPTURE_BYTES:
                    done = True
                    captured.clear()
                else:
                    captured.extend(chunk)
                    if not message.get("more_body", False):
                        done = True
                        try:
                            payload = _JSON.validate_json(captured)
                        except (ValidationError, RecursionError):
                            payload = None
                        finally:
                            captured.clear()
                        if isinstance(payload, dict) and payload.get("method") == "tools/call":
                            params = payload.get("params")
                            if isinstance(params, dict) and params.get("name") == "view_query_map":
                                arguments = params.get("arguments")
                                if isinstance(arguments, dict):
                                    _emit("http_ingress", request_id, arguments)
            return message

        await self.app(scope, observe_receive, send)


class ArgumentToolDiagnostics(Middleware):
    """Observe FastMCP dispatch before tool-specific Pydantic validation.

    This is the public middleware boundary, not a patch of Pydantic internals.
    No decoding, normalization, or replacement of arguments is performed.
    """

    async def on_call_tool(
        self,
        context: MiddlewareContext[CallToolRequestParams],
        call_next: CallNext[CallToolRequestParams, ToolResult],
    ) -> ToolResult:
        if context.message.name == "view_query_map":
            try:
                request = get_http_request()
            except RuntimeError:
                request = None
            request_id = request.scope.get(REQUEST_ID_KEY) if request is not None else None
            if isinstance(request_id, str):
                _emit("tool_dispatch", request_id, context.message.arguments or {})
        return await call_next(context)
