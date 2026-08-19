"""Mint a token against a real chat-service.

Skipped unless both env vars are set: CI has no backend, and a test that needs
one would either be permanently red or quietly deleted.

    set -a; . examples/demo/.env; set +a
    CHAT_LIVE_API_URL="$CHAT_API_URL" CHAT_LIVE_SECRET_KEY="$CHAT_SECRET_KEY" \
      .venv/bin/python -m pytest tests/test_live.py -q

CHAT_LIVE_API_URL is the *origin* (http://localhost:3000), not a URL that
already contains /chat-services/api/v1.
"""

from __future__ import annotations

import os

import pytest
from dhaam_ccrm_chat import AuthenticatedClient
from dhaam_ccrm_chat.api.tokens import mint_token
from dhaam_ccrm_chat.base_path import resolve_base_url
from dhaam_ccrm_chat.models.mint_token_request import MintTokenRequest
from dhaam_ccrm_chat.models.mint_token_response import MintTokenResponse

API_URL = os.environ.get("CHAT_LIVE_API_URL")
SECRET_KEY = os.environ.get("CHAT_LIVE_SECRET_KEY")


@pytest.mark.skipif(
    not API_URL or not SECRET_KEY,
    reason="set CHAT_LIVE_API_URL and CHAT_LIVE_SECRET_KEY to run the live check",
)
def test_live_mint_token() -> None:
    base_url = resolve_base_url(API_URL)
    client = AuthenticatedClient(base_url=base_url, token=SECRET_KEY)

    response = mint_token.sync_detailed(
        client=client, body=MintTokenRequest(user_id="t19-live-check")
    )

    assert response.status_code == 201, (
        f"POST {base_url}/tokens returned {response.status_code}: "
        f"{response.content!r}"
    )
    minted = response.parsed
    assert isinstance(minted, MintTokenResponse)
    # A JWT, not merely a non-empty string -- "" would satisfy a length check.
    assert len(minted.access_token.split(".")) == 3
    assert minted.expires_in > 0
