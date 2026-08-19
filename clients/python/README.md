# `dhaam-ccrm-chat` — generated Python client

Generated from [`openapi/chat-api.yaml`](../../openapi/chat-api.yaml) by
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client).
**Do not edit `dhaam_ccrm_chat/` by hand** — `clients/scripts/generate.sh`
deletes and recreates it, and `clients/scripts/check-drift.sh` fails if it
does not match the spec.

See [`../README.md`](../README.md) for why the clients are generated,
why this generator, and what the generated clients deliberately leave out.

## Install

```bash
pip install ./clients/python
```

Requires Python 3.9+. Runtime dependencies are `httpx`, `attrs` and
`python-dateutil` — nothing else.

## Mint a token

Token minting is the one endpoint your backend calls with the secret key.

```python
from dhaam_ccrm_chat import AuthenticatedClient
from dhaam_ccrm_chat.api.tokens import mint_token
from dhaam_ccrm_chat.base_path import resolve_base_url
from dhaam_ccrm_chat.models.mint_token_request import MintTokenRequest

client = AuthenticatedClient(
    # resolve_base_url() appends /chat-services/api/v1. Pass the *origin*.
    base_url=resolve_base_url("https://chat.example.com"),
    token=os.environ["CHAT_SECRET_KEY"],
)

minted = mint_token.sync(client=client, body=MintTokenRequest(user_id="cust_8f2a1e"))
print(minted.access_token, minted.expires_in)
```

`base_url` is the one thing that is easy to get wrong. `resolve_base_url()`
is generated from the spec's `servers` block; hand-writing the path is how
you end up 404ing on every call while the code looks correct.

## Reading sessions and messages

Every browser-facing endpoint needs **two** credentials: the access token and
the publishable key. `AuthenticatedClient` only models one, so add the other
yourself:

```python
from dhaam_ccrm_chat.api.sessions import list_sessions

client = AuthenticatedClient(
    base_url=resolve_base_url(os.environ["CHAT_API_URL"]),
    token=access_token,                       # Authorization: Bearer <jwt>
    headers={"X-Publishable-Key": os.environ["CHAT_PUBLISHABLE_KEY"]},
)

page = list_sessions.sync(client=client, limit=20)
```

Pass it in the constructor, not via `client.with_headers(...)`. Once a client
has made a request, `with_headers` updates that client's underlying
`httpx.Client` **in place** as well as returning a copy — so the original
starts sending the header too.

`tests/test_base_path.py::test_publishable_key_is_not_sent_automatically`
pins that gap, so it fails loudly if a generator upgrade ever closes it.

## Errors

Non-2xx bodies deserialize to `models.Error`, which carries the same
`ErrorCode` enum the WebSocket protocol uses. `sync()` returns `None` for a
status the spec does not document; use `sync_detailed()` if you need the
status code and headers (`X-Request-Id`, the `RateLimit-*` family).

Async variants of every operation exist as `asyncio()` / `asyncio_detailed()`.

## Tests

```bash
cd clients/python
python3 -m venv .venv && .venv/bin/pip install -e '.[test]'
.venv/bin/python -m pytest tests -q
```

They check what the generator cannot: that requests actually leave for
`/chat-services/api/v1/...`. Add `CHAT_LIVE_API_URL` and
`CHAT_LIVE_SECRET_KEY` to also run the live mint against a real backend.
