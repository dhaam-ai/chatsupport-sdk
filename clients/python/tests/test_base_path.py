"""The generated Python client must request the path chat-service serves.

openapi-python-client takes ``base_url`` from the caller and never consults
the spec's ``servers`` block, so nothing in the generated code guarantees a
request lands under ``/chat-services/api/v1``. The spec once said
``{apiUrl}/v1`` -- a path no route serves -- and a client generated from it
would have imported, type-checked and 404'd on every call.
"""

from __future__ import annotations

import pytest
from dhaam_ccrm_chat import AuthenticatedClient
from dhaam_ccrm_chat.api.sessions import list_sessions
from dhaam_ccrm_chat.api.tokens import mint_token
from dhaam_ccrm_chat.base_path import BASE_PATH, resolve_base_url
from dhaam_ccrm_chat.models.mint_token_request import MintTokenRequest
from dhaam_ccrm_chat.models.mint_token_response import MintTokenResponse
from dhaam_ccrm_chat.models.session_summary_page import SessionSummaryPage


def test_mint_token_hits_spec_base_path(recorder) -> None:
    recorder.set_response(
        201, {"accessToken": "header.body.signature", "expiresIn": 3600}
    )
    client = AuthenticatedClient(
        base_url=resolve_base_url(recorder.origin),
        token="dhk_" + "test_" + "not-a-real-key",
    )

    minted = mint_token.sync(client=client, body=MintTokenRequest(user_id="u_1"))

    assert recorder.path == "/chat-services/api/v1/tokens", (
        "every route on chat-service is mounted under "
        f"{BASE_PATH}; a client that drops it 404s on every call "
        "while looking correct"
    )
    assert isinstance(minted, MintTokenResponse)
    assert minted.access_token == "header.body.signature"
    assert minted.expires_in == 3600
    # POST /tokens is the one place the secret key is a valid credential.
    assert recorder.headers["authorization"].startswith("Bearer ")


def test_session_endpoint_hits_spec_base_path(recorder) -> None:
    recorder.set_response(200, {"sessions": [], "hasMore": False})
    client = AuthenticatedClient(
        base_url=resolve_base_url(recorder.origin),
        token="header.body.signature",
    )

    page = list_sessions.sync(client=client)

    assert recorder.path == "/chat-services/api/v1/sessions"
    assert isinstance(page, SessionSummaryPage)
    # The generator applies the spec's `default: 20` on `limit` client-side,
    # so a caller who passes nothing still sends one. Recorded here because
    # it is a real wire difference from the Go client, which omits it.
    assert recorder.query == "limit=20"


def test_publishable_key_is_not_sent_automatically(recorder) -> None:
    """The Python client does NOT satisfy the spec's two-credential rule.

    Every browser-facing endpoint requires ``Authorization: Bearer
    <accessToken>`` *and* ``X-Publishable-Key`` (PRD 10.1).
    openapi-python-client models a single credential -- ``AuthenticatedClient``
    has one ``token`` -- and silently omits the apiKey scheme, so the caller
    has to supply that header.

    This test pins the gap rather than papering over it: if a generator
    upgrade ever starts sending the header, this fails and the README's
    "what you still have to write" section is out of date. The Go client
    (ogen) does wire both, which is why only Python needs this note.
    """
    recorder.set_response(200, {"sessions": [], "hasMore": False})
    bare = AuthenticatedClient(
        base_url=resolve_base_url(recorder.origin), token="header.body.signature"
    )

    list_sessions.sync(client=bare)
    assert "x-publishable-key" not in recorder.headers

    # The workaround the README documents: pass it as a constructor header.
    #
    # Not `bare.with_headers(...)`. That mutates the receiver's underlying
    # httpx client in place once one has been created, so `bare` would start
    # sending the key too -- a shared-state surprise, and one that would make
    # this very test pass even if with_headers returned the wrong object.
    with_key = AuthenticatedClient(
        base_url=resolve_base_url(recorder.origin),
        token="header.body.signature",
        headers={"X-Publishable-Key": "dhp_" + "test_" + "not-a-real-key"},
    )
    list_sessions.sync(client=with_key)
    assert recorder.headers["x-publishable-key"].startswith("dhp_")


@pytest.mark.parametrize(
    ("api_url", "expected"),
    [
        ("https://chat.example.com", "https://chat.example.com/chat-services/api/v1"),
        ("https://chat.example.com/", "https://chat.example.com/chat-services/api/v1"),
        ("http://localhost:3000", "http://localhost:3000/chat-services/api/v1"),
    ],
)
def test_resolve_base_url(api_url: str, expected: str) -> None:
    assert resolve_base_url(api_url) == expected
