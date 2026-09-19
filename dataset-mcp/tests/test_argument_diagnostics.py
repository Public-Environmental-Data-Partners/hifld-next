from __future__ import annotations

import asyncio
import json
import logging

import pytest
from starlette.types import Message, Receive, Scope, Send

from app.argument_diagnostics import MAX_CAPTURE_BYTES, ArgumentIngressDiagnostics


@pytest.mark.parametrize(
    "body, expected",
    [
        (
            b'{"method":"tools/call","params":{"name":"view_query_map",'
            b'"arguments":{"layers":[],"camera":null}}}',
            ("array", "null"),
        ),
        (
            b'{"method":"tools/call","params":{"name":"view_query_map","arguments":{}}}',
            ("missing", "missing"),
        ),
        (b'{"method":"tools/call","params":{"name":"private-tool","arguments":{}}}', None),
        (b'{"method":"initialize"}', None),
        (b"not json", None),
        (b"\xff", None),
        (b"[" * 1000, None),
        (b" " * (MAX_CAPTURE_BYTES + 1), None),
    ],
)
def test_ingress_preserves_chunked_messages_and_skips_unsafe_capture(
    body: bytes,
    expected: tuple[str, str] | None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="uvicorn.error.argument_diagnostics")
    messages: list[Message] = [
        {"type": "http.request", "body": body[:10], "more_body": True},
        {"type": "http.request", "body": body[10:], "more_body": False},
        {"type": "http.disconnect"},
    ]
    received: list[Message] = []

    async def receive() -> Message:
        return messages[len(received)]

    async def send(message: Message) -> None:
        raise AssertionError("The observer must not send responses")

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        for _ in messages:
            received.append(await receive())

    asyncio.run(
        ArgumentIngressDiagnostics(app)(
            {"type": "http", "method": "POST", "path": "/mcp"},
            receive,
            send,
        )
    )
    assert all(actual is original for actual, original in zip(received, messages, strict=True))
    events = [
        json.loads(record.message)
        for record in caplog.records
        if record.name == "uvicorn.error.argument_diagnostics"
    ]
    if expected is None:
        assert events == []
    else:
        assert len(events) == 1
        assert (events[0]["layers_type"], events[0]["camera_type"]) == expected
