"""A throwaway HTTP server that records what the generated client put on the wire.

The generated client builds its own ``httpx.Client``, so the only honest place
to see the request it produced is a real socket. This is cheaper to reason
about than a mock transport and exercises the same code path a consumer would.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Iterator, Optional
from urllib.parse import urlsplit

import pytest


@dataclass
class Recorder:
    """The origin to point a client at, plus whatever reached the server."""

    origin: str
    set_response: Callable[[int, Any], None]
    #: Path only. Kept separate from the query string so a test asserting on
    #: the route is not also asserting on defaults the generator fills in.
    path: Optional[str] = None
    query: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""


@pytest.fixture
def recorder() -> Iterator[Recorder]:
    response = {"status": 201, "payload": {}}
    rec: Recorder

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
            self._record()

        def do_GET(self) -> None:  # noqa: N802
            self._record()

        def _record(self) -> None:
            split = urlsplit(self.path)
            rec.path = split.path
            rec.query = split.query
            rec.headers = {k.lower(): v for k, v in self.headers.items()}
            length = int(self.headers.get("Content-Length") or 0)
            rec.body = self.rfile.read(length) if length else b""

            body = json.dumps(response["payload"]).encode()
            self.send_response(int(response["status"]))
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: Any) -> None:
            """Silence the default stderr access log."""

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def set_response(status: int, payload: Any) -> None:
        response["status"] = status
        response["payload"] = payload

    rec = Recorder(
        origin=f"http://127.0.0.1:{server.server_address[1]}",
        set_response=set_response,
    )

    try:
        yield rec
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
