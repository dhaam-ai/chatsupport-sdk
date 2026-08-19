from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_session import ChatSession
from ...models.close_session_request import CloseSessionRequest
from ...models.error import Error
from ...types import Response


def _get_kwargs(
    session_id: str,
    *,
    body: CloseSessionRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/sessions/{session_id}/close".format(
            session_id=session_id,
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ChatSession, Error]]:
    if response.status_code == 200:
        response_200 = ChatSession.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

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
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: CloseSessionRequest,
) -> Response[Union[ChatSession, Error]]:
    """Close a session.

     Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action in the T1 catalog, so it is a
    REST-only operation in v2, same as v1.

    Idempotency: naturally idempotent. Calling this on a session that is
    already `CLOSED` returns `200` with its current state, not an error
    — repeats are always safe with no `Idempotency-Key` needed.

    Args:
        session_id (str):
        body (CloseSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ChatSession, Error]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: CloseSessionRequest,
) -> Optional[Union[ChatSession, Error]]:
    """Close a session.

     Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action in the T1 catalog, so it is a
    REST-only operation in v2, same as v1.

    Idempotency: naturally idempotent. Calling this on a session that is
    already `CLOSED` returns `200` with its current state, not an error
    — repeats are always safe with no `Idempotency-Key` needed.

    Args:
        session_id (str):
        body (CloseSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ChatSession, Error]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: CloseSessionRequest,
) -> Response[Union[ChatSession, Error]]:
    """Close a session.

     Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action in the T1 catalog, so it is a
    REST-only operation in v2, same as v1.

    Idempotency: naturally idempotent. Calling this on a session that is
    already `CLOSED` returns `200` with its current state, not an error
    — repeats are always safe with no `Idempotency-Key` needed.

    Args:
        session_id (str):
        body (CloseSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ChatSession, Error]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: CloseSessionRequest,
) -> Optional[Union[ChatSession, Error]]:
    """Close a session.

     Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action in the T1 catalog, so it is a
    REST-only operation in v2, same as v1.

    Idempotency: naturally idempotent. Calling this on a session that is
    already `CLOSED` returns `200` with its current state, not an error
    — repeats are always safe with no `Idempotency-Key` needed.

    Args:
        session_id (str):
        body (CloseSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ChatSession, Error]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            body=body,
        )
    ).parsed
