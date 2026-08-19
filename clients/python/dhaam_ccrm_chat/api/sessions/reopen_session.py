from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_session import ChatSession
from ...models.error import Error
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    idempotency_key: Union[Unset, str] = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/sessions/{session_id}/reopen".format(
            session_id=session_id,
        ),
    }

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ChatSession, Error]]:
    if response.status_code == 200:
        response_200 = ChatSession.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

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
    idempotency_key: Union[Unset, str] = UNSET,
) -> Response[Union[ChatSession, Error]]:
    """Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN` — the exact semantics PRD
    §12.5 confirms for v1's `reopenSession()`. There is no WebSocket
    frame type for this action in the T1 catalog, so it is REST-only, as
    in v1.

    Only a session in `CLOSED` status can be reopened. Reopening a
    session in any other status returns `400 VALIDATION_FAILED` — this
    is a request-validity error given current state, not a
    `SESSION_CLOSED` error (which means the opposite: the session *is*
    closed and an action requires it not to be).

    Idempotency: supports `Idempotency-Key`, since reopening has a
    real side effect (bypassing the bot, notifying agent routing) that
    should not be duplicated by a naive client retry.

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ChatSession, Error]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Optional[Union[ChatSession, Error]]:
    """Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN` — the exact semantics PRD
    §12.5 confirms for v1's `reopenSession()`. There is no WebSocket
    frame type for this action in the T1 catalog, so it is REST-only, as
    in v1.

    Only a session in `CLOSED` status can be reopened. Reopening a
    session in any other status returns `400 VALIDATION_FAILED` — this
    is a request-validity error given current state, not a
    `SESSION_CLOSED` error (which means the opposite: the session *is*
    closed and an action requires it not to be).

    Idempotency: supports `Idempotency-Key`, since reopening has a
    real side effect (bypassing the bot, notifying agent routing) that
    should not be duplicated by a naive client retry.

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ChatSession, Error]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Response[Union[ChatSession, Error]]:
    """Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN` — the exact semantics PRD
    §12.5 confirms for v1's `reopenSession()`. There is no WebSocket
    frame type for this action in the T1 catalog, so it is REST-only, as
    in v1.

    Only a session in `CLOSED` status can be reopened. Reopening a
    session in any other status returns `400 VALIDATION_FAILED` — this
    is a request-validity error given current state, not a
    `SESSION_CLOSED` error (which means the opposite: the session *is*
    closed and an action requires it not to be).

    Idempotency: supports `Idempotency-Key`, since reopening has a
    real side effect (bypassing the bot, notifying agent routing) that
    should not be duplicated by a naive client retry.

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ChatSession, Error]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Optional[Union[ChatSession, Error]]:
    """Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN` — the exact semantics PRD
    §12.5 confirms for v1's `reopenSession()`. There is no WebSocket
    frame type for this action in the T1 catalog, so it is REST-only, as
    in v1.

    Only a session in `CLOSED` status can be reopened. Reopening a
    session in any other status returns `400 VALIDATION_FAILED` — this
    is a request-validity error given current state, not a
    `SESSION_CLOSED` error (which means the opposite: the session *is*
    closed and an action requires it not to be).

    Idempotency: supports `Idempotency-Key`, since reopening has a
    real side effect (bypassing the bot, notifying agent routing) that
    should not be duplicated by a naive client retry.

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):

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
            idempotency_key=idempotency_key,
        )
    ).parsed
