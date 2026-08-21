from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_session_request import CreateSessionRequest
from ...models.create_session_response_201 import CreateSessionResponse201
from ...models.error import Error
from ...types import Response


def _get_kwargs(
    *,
    body: CreateSessionRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/chat/sessions",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[CreateSessionResponse201, Error]]:
    if response.status_code == 201:
        response_201 = CreateSessionResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if response.status_code == 500:
        response_500 = Error.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[CreateSessionResponse201, Error]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
) -> Response[Union[CreateSessionResponse201, Error]]:
    r"""Create a new chat session for the authenticated customer.

     **Path corrected**: `POST /chat/sessions`, not `POST /sessions`
    (`chat.routes.ts:190`).

    Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields.

    **Open Question (not resolved by the PRD):** whether
    `@dhaam-ccrm/core` should ever call this directly, or whether
    session bootstrap stays entirely WebSocket-driven
    (`connection.ack`). As of this revision, core does not call it —
    confirmed by the contract audit that produced this correction.

    **Response shape corrected**: the actual `201` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    enum codes) — **not** the full `ChatSession` this operation
    previously promised. `chat.routes.ts:215-218` builds the reply from
    exactly those three fields off `chatSessionService.createSession()`'s
    return value; no other field is ever included.

    **No `Location` header is set.** An earlier revision of this
    document documented one on the `201`; the handler never calls
    `reply.header('Location', ...)`, so it has been removed rather than
    left describing a response the backend does not send.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above.
    What IS true: a customer with an already-active session gets that
    session back unchanged rather than a second one
    (`chat-session.service.ts:42-72`), which is a property of the
    domain (one active session per customer), not of a request replay
    key.

    Args:
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[CreateSessionResponse201, Error]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
) -> Optional[Union[CreateSessionResponse201, Error]]:
    r"""Create a new chat session for the authenticated customer.

     **Path corrected**: `POST /chat/sessions`, not `POST /sessions`
    (`chat.routes.ts:190`).

    Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields.

    **Open Question (not resolved by the PRD):** whether
    `@dhaam-ccrm/core` should ever call this directly, or whether
    session bootstrap stays entirely WebSocket-driven
    (`connection.ack`). As of this revision, core does not call it —
    confirmed by the contract audit that produced this correction.

    **Response shape corrected**: the actual `201` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    enum codes) — **not** the full `ChatSession` this operation
    previously promised. `chat.routes.ts:215-218` builds the reply from
    exactly those three fields off `chatSessionService.createSession()`'s
    return value; no other field is ever included.

    **No `Location` header is set.** An earlier revision of this
    document documented one on the `201`; the handler never calls
    `reply.header('Location', ...)`, so it has been removed rather than
    left describing a response the backend does not send.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above.
    What IS true: a customer with an already-active session gets that
    session back unchanged rather than a second one
    (`chat-session.service.ts:42-72`), which is a property of the
    domain (one active session per customer), not of a request replay
    key.

    Args:
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[CreateSessionResponse201, Error]
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
) -> Response[Union[CreateSessionResponse201, Error]]:
    r"""Create a new chat session for the authenticated customer.

     **Path corrected**: `POST /chat/sessions`, not `POST /sessions`
    (`chat.routes.ts:190`).

    Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields.

    **Open Question (not resolved by the PRD):** whether
    `@dhaam-ccrm/core` should ever call this directly, or whether
    session bootstrap stays entirely WebSocket-driven
    (`connection.ack`). As of this revision, core does not call it —
    confirmed by the contract audit that produced this correction.

    **Response shape corrected**: the actual `201` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    enum codes) — **not** the full `ChatSession` this operation
    previously promised. `chat.routes.ts:215-218` builds the reply from
    exactly those three fields off `chatSessionService.createSession()`'s
    return value; no other field is ever included.

    **No `Location` header is set.** An earlier revision of this
    document documented one on the `201`; the handler never calls
    `reply.header('Location', ...)`, so it has been removed rather than
    left describing a response the backend does not send.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above.
    What IS true: a customer with an already-active session gets that
    session back unchanged rather than a second one
    (`chat-session.service.ts:42-72`), which is a property of the
    domain (one active session per customer), not of a request replay
    key.

    Args:
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[CreateSessionResponse201, Error]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
) -> Optional[Union[CreateSessionResponse201, Error]]:
    r"""Create a new chat session for the authenticated customer.

     **Path corrected**: `POST /chat/sessions`, not `POST /sessions`
    (`chat.routes.ts:190`).

    Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields.

    **Open Question (not resolved by the PRD):** whether
    `@dhaam-ccrm/core` should ever call this directly, or whether
    session bootstrap stays entirely WebSocket-driven
    (`connection.ack`). As of this revision, core does not call it —
    confirmed by the contract audit that produced this correction.

    **Response shape corrected**: the actual `201` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    enum codes) — **not** the full `ChatSession` this operation
    previously promised. `chat.routes.ts:215-218` builds the reply from
    exactly those three fields off `chatSessionService.createSession()`'s
    return value; no other field is ever included.

    **No `Location` header is set.** An earlier revision of this
    document documented one on the `201`; the handler never calls
    `reply.header('Location', ...)`, so it has been removed rather than
    left describing a response the backend does not send.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above.
    What IS true: a customer with an already-active session gets that
    session back unchanged rather than a second one
    (`chat-session.service.ts:42-72`), which is a property of the
    domain (one active session per customer), not of a request replay
    key.

    Args:
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[CreateSessionResponse201, Error]
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
