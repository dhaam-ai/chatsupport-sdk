from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_session import ChatSession
from ...models.create_session_request import CreateSessionRequest
from ...models.error import Error
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: CreateSessionRequest,
    idempotency_key: Union[Unset, str] = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/sessions",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ChatSession, Error]]:
    if response.status_code == 201:
        response_201 = ChatSession.from_dict(response.json())

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
) -> Response[Union[ChatSession, Error]]:
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
    idempotency_key: Union[Unset, str] = UNSET,
) -> Response[Union[ChatSession, Error]]:
    """Create a new chat session for the authenticated customer.

     Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields,
    which fixes v1's pattern of re-sending `customerId`/`customerName`/
    `customerEmail` in the body even though the same values were already
    embedded in the auth token.

    **Open Question (not resolved by the PRD):** PRD §12.3 documents
    that in v1, explicit REST session creation is a **client-orchestrated
    recovery path** — used only when the socket's `connection.ack`
    resolves to an already-`CLOSED` session — and PRD §8.3 explicitly
    leaves open whether v2 keeps this client-side responsibility or
    moves it server-side inside `connection.ack` itself. This endpoint
    is included because backend (non-WebSocket) SDKs need an explicit,
    REST-only way to start a session regardless of how that question is
    resolved for the browser client; whether `@dhaam-ccrm/core` ever
    calls it directly is exactly the open question above, not something
    this document can settle.

    Idempotency: supports `Idempotency-Key`. Without it, retrying after
    a timeout may create two sessions; with it, a replayed request
    within the key's 24h window returns the original session unchanged.

    Args:
        idempotency_key (Union[Unset, str]):
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ChatSession, Error]]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Optional[Union[ChatSession, Error]]:
    """Create a new chat session for the authenticated customer.

     Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields,
    which fixes v1's pattern of re-sending `customerId`/`customerName`/
    `customerEmail` in the body even though the same values were already
    embedded in the auth token.

    **Open Question (not resolved by the PRD):** PRD §12.3 documents
    that in v1, explicit REST session creation is a **client-orchestrated
    recovery path** — used only when the socket's `connection.ack`
    resolves to an already-`CLOSED` session — and PRD §8.3 explicitly
    leaves open whether v2 keeps this client-side responsibility or
    moves it server-side inside `connection.ack` itself. This endpoint
    is included because backend (non-WebSocket) SDKs need an explicit,
    REST-only way to start a session regardless of how that question is
    resolved for the browser client; whether `@dhaam-ccrm/core` ever
    calls it directly is exactly the open question above, not something
    this document can settle.

    Idempotency: supports `Idempotency-Key`. Without it, retrying after
    a timeout may create two sessions; with it, a replayed request
    within the key's 24h window returns the original session unchanged.

    Args:
        idempotency_key (Union[Unset, str]):
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ChatSession, Error]
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Response[Union[ChatSession, Error]]:
    """Create a new chat session for the authenticated customer.

     Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields,
    which fixes v1's pattern of re-sending `customerId`/`customerName`/
    `customerEmail` in the body even though the same values were already
    embedded in the auth token.

    **Open Question (not resolved by the PRD):** PRD §12.3 documents
    that in v1, explicit REST session creation is a **client-orchestrated
    recovery path** — used only when the socket's `connection.ack`
    resolves to an already-`CLOSED` session — and PRD §8.3 explicitly
    leaves open whether v2 keeps this client-side responsibility or
    moves it server-side inside `connection.ack` itself. This endpoint
    is included because backend (non-WebSocket) SDKs need an explicit,
    REST-only way to start a session regardless of how that question is
    resolved for the browser client; whether `@dhaam-ccrm/core` ever
    calls it directly is exactly the open question above, not something
    this document can settle.

    Idempotency: supports `Idempotency-Key`. Without it, retrying after
    a timeout may create two sessions; with it, a replayed request
    within the key's 24h window returns the original session unchanged.

    Args:
        idempotency_key (Union[Unset, str]):
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ChatSession, Error]]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Optional[Union[ChatSession, Error]]:
    """Create a new chat session for the authenticated customer.

     Starts a new session, defaulting to `mode: BOT` and `status: OPEN`
    (PRD §12.5's observed lifecycle). The caller's identity comes
    entirely from the validated `accessToken` — the request body carries
    only optional client-side context, never customer identity fields,
    which fixes v1's pattern of re-sending `customerId`/`customerName`/
    `customerEmail` in the body even though the same values were already
    embedded in the auth token.

    **Open Question (not resolved by the PRD):** PRD §12.3 documents
    that in v1, explicit REST session creation is a **client-orchestrated
    recovery path** — used only when the socket's `connection.ack`
    resolves to an already-`CLOSED` session — and PRD §8.3 explicitly
    leaves open whether v2 keeps this client-side responsibility or
    moves it server-side inside `connection.ack` itself. This endpoint
    is included because backend (non-WebSocket) SDKs need an explicit,
    REST-only way to start a session regardless of how that question is
    resolved for the browser client; whether `@dhaam-ccrm/core` ever
    calls it directly is exactly the open question above, not something
    this document can settle.

    Idempotency: supports `Idempotency-Key`. Without it, retrying after
    a timeout may create two sessions; with it, a replayed request
    within the key's 24h window returns the original session unchanged.

    Args:
        idempotency_key (Union[Unset, str]):
        body (CreateSessionRequest): Customer identity is derived entirely from the validated
            `accessToken` — this body never repeats it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ChatSession, Error]
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
