from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.close_session_request import CloseSessionRequest
from ...models.close_session_response_200 import CloseSessionResponse200
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
        "url": "/chat/sessions/{session_id}/close".format(
            session_id=session_id,
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[CloseSessionResponse200, Error]]:
    if response.status_code == 200:
        response_200 = CloseSessionResponse200.from_dict(response.json())

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
) -> Response[Union[CloseSessionResponse200, Error]]:
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
) -> Response[Union[CloseSessionResponse200, Error]]:
    r"""Close a session.

     **Path corrected**: `POST /chat/sessions/{sessionId}/close`
    (`chat.routes.ts:282`).

    Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action, so it is REST-only.

    Naturally idempotent: calling this on a session that is already
    `CLOSED` returns `200` with its current state, not an error.

    **The request body is accepted but entirely ignored.** The handler
    never validates or reads it (`chat.routes.ts:282-293` calls no
    `validate()` on `request.body` at all), and
    `chatSessionService.closeSession(sessionId)` takes only the session
    id — no `reason` parameter exists anywhere in its signature
    (`chat-session.service.ts:227`). `CloseSessionRequest.reason` below
    is kept in this schema only because sending it is harmless (it is
    silently dropped), not because the backend does anything with it.

    **Response shape corrected**: the actual `200` body is
    `SessionCloseResult` (`{sessionId, status, closedAt}`, raw integer
    `status`) — **not** the full `ChatSession` this operation
    previously promised (`chat.routes.ts:289-292`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch.** `packages/core`'s
    `SessionActions.closeSession` contract requires the full
    `ChatSession` shape (`packages/core/src/client/types.ts:105-108` —
    \"unlike the WebSocket `SessionSnapshot`... carries full `Profile`
    objects\"), which this response cannot satisfy on its own: it has no
    `createdAt`, `assignedAgent`, `customer`, or `ticket`, and uses
    `sessionId` where `ChatSession` needs `id`.
    `@dhaam-ccrm/rest`'s `createSessionActions` adapter calls this
    endpoint and then immediately issues a follow-up
    `GET /chat/sessions/{sessionId}/full` to assemble the full
    `ChatSession` core requires — two HTTP round trips per
    `closeSession()` call. This is now implemented (see
    `packages/rest/src/envelope.ts` and the session-actions adapter),
    not a workaround pending a backend change.

    Args:
        session_id (str):
        body (CloseSessionRequest): Accepted but currently ignored by the backend — see the `POST
            /chat/sessions/{sessionId}/close` operation description for why `reason` has no effect
            today (`chatSessionService.closeSession` takes only the session id).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[CloseSessionResponse200, Error]]
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
) -> Optional[Union[CloseSessionResponse200, Error]]:
    r"""Close a session.

     **Path corrected**: `POST /chat/sessions/{sessionId}/close`
    (`chat.routes.ts:282`).

    Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action, so it is REST-only.

    Naturally idempotent: calling this on a session that is already
    `CLOSED` returns `200` with its current state, not an error.

    **The request body is accepted but entirely ignored.** The handler
    never validates or reads it (`chat.routes.ts:282-293` calls no
    `validate()` on `request.body` at all), and
    `chatSessionService.closeSession(sessionId)` takes only the session
    id — no `reason` parameter exists anywhere in its signature
    (`chat-session.service.ts:227`). `CloseSessionRequest.reason` below
    is kept in this schema only because sending it is harmless (it is
    silently dropped), not because the backend does anything with it.

    **Response shape corrected**: the actual `200` body is
    `SessionCloseResult` (`{sessionId, status, closedAt}`, raw integer
    `status`) — **not** the full `ChatSession` this operation
    previously promised (`chat.routes.ts:289-292`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch.** `packages/core`'s
    `SessionActions.closeSession` contract requires the full
    `ChatSession` shape (`packages/core/src/client/types.ts:105-108` —
    \"unlike the WebSocket `SessionSnapshot`... carries full `Profile`
    objects\"), which this response cannot satisfy on its own: it has no
    `createdAt`, `assignedAgent`, `customer`, or `ticket`, and uses
    `sessionId` where `ChatSession` needs `id`.
    `@dhaam-ccrm/rest`'s `createSessionActions` adapter calls this
    endpoint and then immediately issues a follow-up
    `GET /chat/sessions/{sessionId}/full` to assemble the full
    `ChatSession` core requires — two HTTP round trips per
    `closeSession()` call. This is now implemented (see
    `packages/rest/src/envelope.ts` and the session-actions adapter),
    not a workaround pending a backend change.

    Args:
        session_id (str):
        body (CloseSessionRequest): Accepted but currently ignored by the backend — see the `POST
            /chat/sessions/{sessionId}/close` operation description for why `reason` has no effect
            today (`chatSessionService.closeSession` takes only the session id).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[CloseSessionResponse200, Error]
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
) -> Response[Union[CloseSessionResponse200, Error]]:
    r"""Close a session.

     **Path corrected**: `POST /chat/sessions/{sessionId}/close`
    (`chat.routes.ts:282`).

    Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action, so it is REST-only.

    Naturally idempotent: calling this on a session that is already
    `CLOSED` returns `200` with its current state, not an error.

    **The request body is accepted but entirely ignored.** The handler
    never validates or reads it (`chat.routes.ts:282-293` calls no
    `validate()` on `request.body` at all), and
    `chatSessionService.closeSession(sessionId)` takes only the session
    id — no `reason` parameter exists anywhere in its signature
    (`chat-session.service.ts:227`). `CloseSessionRequest.reason` below
    is kept in this schema only because sending it is harmless (it is
    silently dropped), not because the backend does anything with it.

    **Response shape corrected**: the actual `200` body is
    `SessionCloseResult` (`{sessionId, status, closedAt}`, raw integer
    `status`) — **not** the full `ChatSession` this operation
    previously promised (`chat.routes.ts:289-292`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch.** `packages/core`'s
    `SessionActions.closeSession` contract requires the full
    `ChatSession` shape (`packages/core/src/client/types.ts:105-108` —
    \"unlike the WebSocket `SessionSnapshot`... carries full `Profile`
    objects\"), which this response cannot satisfy on its own: it has no
    `createdAt`, `assignedAgent`, `customer`, or `ticket`, and uses
    `sessionId` where `ChatSession` needs `id`.
    `@dhaam-ccrm/rest`'s `createSessionActions` adapter calls this
    endpoint and then immediately issues a follow-up
    `GET /chat/sessions/{sessionId}/full` to assemble the full
    `ChatSession` core requires — two HTTP round trips per
    `closeSession()` call. This is now implemented (see
    `packages/rest/src/envelope.ts` and the session-actions adapter),
    not a workaround pending a backend change.

    Args:
        session_id (str):
        body (CloseSessionRequest): Accepted but currently ignored by the backend — see the `POST
            /chat/sessions/{sessionId}/close` operation description for why `reason` has no effect
            today (`chatSessionService.closeSession` takes only the session id).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[CloseSessionResponse200, Error]]
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
) -> Optional[Union[CloseSessionResponse200, Error]]:
    r"""Close a session.

     **Path corrected**: `POST /chat/sessions/{sessionId}/close`
    (`chat.routes.ts:282`).

    Transitions `status` to `CLOSED`. Backs the core method
    `client.closeSession(): Promise<void>` (PRD §6.2) — there is no
    WebSocket frame type for this action, so it is REST-only.

    Naturally idempotent: calling this on a session that is already
    `CLOSED` returns `200` with its current state, not an error.

    **The request body is accepted but entirely ignored.** The handler
    never validates or reads it (`chat.routes.ts:282-293` calls no
    `validate()` on `request.body` at all), and
    `chatSessionService.closeSession(sessionId)` takes only the session
    id — no `reason` parameter exists anywhere in its signature
    (`chat-session.service.ts:227`). `CloseSessionRequest.reason` below
    is kept in this schema only because sending it is harmless (it is
    silently dropped), not because the backend does anything with it.

    **Response shape corrected**: the actual `200` body is
    `SessionCloseResult` (`{sessionId, status, closedAt}`, raw integer
    `status`) — **not** the full `ChatSession` this operation
    previously promised (`chat.routes.ts:289-292`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch.** `packages/core`'s
    `SessionActions.closeSession` contract requires the full
    `ChatSession` shape (`packages/core/src/client/types.ts:105-108` —
    \"unlike the WebSocket `SessionSnapshot`... carries full `Profile`
    objects\"), which this response cannot satisfy on its own: it has no
    `createdAt`, `assignedAgent`, `customer`, or `ticket`, and uses
    `sessionId` where `ChatSession` needs `id`.
    `@dhaam-ccrm/rest`'s `createSessionActions` adapter calls this
    endpoint and then immediately issues a follow-up
    `GET /chat/sessions/{sessionId}/full` to assemble the full
    `ChatSession` core requires — two HTTP round trips per
    `closeSession()` call. This is now implemented (see
    `packages/rest/src/envelope.ts` and the session-actions adapter),
    not a workaround pending a backend change.

    Args:
        session_id (str):
        body (CloseSessionRequest): Accepted but currently ignored by the backend — see the `POST
            /chat/sessions/{sessionId}/close` operation description for why `reason` has no effect
            today (`chatSessionService.closeSession` takes only the session id).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[CloseSessionResponse200, Error]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            body=body,
        )
    ).parsed
