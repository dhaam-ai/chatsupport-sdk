from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.reopen_session_response_200 import ReopenSessionResponse200
from ...types import Response


def _get_kwargs(
    session_id: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/chat/sessions/{session_id}/reopen".format(
            session_id=session_id,
        ),
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, ReopenSessionResponse200]]:
    if response.status_code == 200:
        response_200 = ReopenSessionResponse200.from_dict(response.json())

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
) -> Response[Union[Error, ReopenSessionResponse200]]:
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
) -> Response[Union[Error, ReopenSessionResponse200]]:
    r"""Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     **Path corrected**: `POST /chat/sessions/{sessionId}/reopen`
    (`chat.routes.ts:296`).

    Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN`. There is no WebSocket
    frame type for this action, so it is REST-only.

    **No status guard exists.** An earlier revision of this document
    claimed reopening a session that is not `CLOSED` returns
    `400 VALIDATION_FAILED`. **That is not implemented.**
    `reopenSession` (`chat-session.service.ts:358-380`) applies no
    status check at all — it unconditionally applies the
    `WAITING_FOR_AGENT`/`HUMAN` transition to whatever status the
    target session is currently in.

    **Convergence behavior (real, and worth documenting precisely):** if
    the caller's (tenantId, customerId) already has a *different* active
    session, this endpoint does not reopen the requested one at all — it
    returns that other, already-active session's `{id, status, mode}`
    unchanged (`chat-session.service.ts:364-371`). This is the actual
    mechanism behind \"reopening a stale session is safe,\" not a
    request-level idempotency key.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above;
    removed from this operation's parameters.

    **Response shape corrected**: the actual `200` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    codes) — **not** the full `ChatSession` this operation previously
    promised (`chat.routes.ts:310-313`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch**, for the same
    reason and in the same way documented on
    `POST /chat/sessions/{sessionId}/close` above: `SessionActions
    .reopenSession` needs the full `ChatSession`, so the adapter calls
    this endpoint and then `GET /chat/sessions/{sessionId}/full` — using
    whichever `id` this response actually returns, which per the
    convergence behavior above may not be the `sessionId` the caller
    requested. This is now implemented, not a proposal.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, ReopenSessionResponse200]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[Error, ReopenSessionResponse200]]:
    r"""Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     **Path corrected**: `POST /chat/sessions/{sessionId}/reopen`
    (`chat.routes.ts:296`).

    Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN`. There is no WebSocket
    frame type for this action, so it is REST-only.

    **No status guard exists.** An earlier revision of this document
    claimed reopening a session that is not `CLOSED` returns
    `400 VALIDATION_FAILED`. **That is not implemented.**
    `reopenSession` (`chat-session.service.ts:358-380`) applies no
    status check at all — it unconditionally applies the
    `WAITING_FOR_AGENT`/`HUMAN` transition to whatever status the
    target session is currently in.

    **Convergence behavior (real, and worth documenting precisely):** if
    the caller's (tenantId, customerId) already has a *different* active
    session, this endpoint does not reopen the requested one at all — it
    returns that other, already-active session's `{id, status, mode}`
    unchanged (`chat-session.service.ts:364-371`). This is the actual
    mechanism behind \"reopening a stale session is safe,\" not a
    request-level idempotency key.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above;
    removed from this operation's parameters.

    **Response shape corrected**: the actual `200` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    codes) — **not** the full `ChatSession` this operation previously
    promised (`chat.routes.ts:310-313`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch**, for the same
    reason and in the same way documented on
    `POST /chat/sessions/{sessionId}/close` above: `SessionActions
    .reopenSession` needs the full `ChatSession`, so the adapter calls
    this endpoint and then `GET /chat/sessions/{sessionId}/full` — using
    whichever `id` this response actually returns, which per the
    convergence behavior above may not be the `sessionId` the caller
    requested. This is now implemented, not a proposal.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, ReopenSessionResponse200]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[Union[Error, ReopenSessionResponse200]]:
    r"""Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     **Path corrected**: `POST /chat/sessions/{sessionId}/reopen`
    (`chat.routes.ts:296`).

    Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN`. There is no WebSocket
    frame type for this action, so it is REST-only.

    **No status guard exists.** An earlier revision of this document
    claimed reopening a session that is not `CLOSED` returns
    `400 VALIDATION_FAILED`. **That is not implemented.**
    `reopenSession` (`chat-session.service.ts:358-380`) applies no
    status check at all — it unconditionally applies the
    `WAITING_FOR_AGENT`/`HUMAN` transition to whatever status the
    target session is currently in.

    **Convergence behavior (real, and worth documenting precisely):** if
    the caller's (tenantId, customerId) already has a *different* active
    session, this endpoint does not reopen the requested one at all — it
    returns that other, already-active session's `{id, status, mode}`
    unchanged (`chat-session.service.ts:364-371`). This is the actual
    mechanism behind \"reopening a stale session is safe,\" not a
    request-level idempotency key.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above;
    removed from this operation's parameters.

    **Response shape corrected**: the actual `200` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    codes) — **not** the full `ChatSession` this operation previously
    promised (`chat.routes.ts:310-313`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch**, for the same
    reason and in the same way documented on
    `POST /chat/sessions/{sessionId}/close` above: `SessionActions
    .reopenSession` needs the full `ChatSession`, so the adapter calls
    this endpoint and then `GET /chat/sessions/{sessionId}/full` — using
    whichever `id` this response actually returns, which per the
    convergence behavior above may not be the `sessionId` the caller
    requested. This is now implemented, not a proposal.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, ReopenSessionResponse200]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[Error, ReopenSessionResponse200]]:
    r"""Reopen a closed session, bypassing the bot straight to WAITING_FOR_AGENT.

     **Path corrected**: `POST /chat/sessions/{sessionId}/reopen`
    (`chat.routes.ts:296`).

    Backs `client.reopenSession(sessionId): Promise<ChatSession>` (PRD
    §6.2). Deliberately **bypasses** the AI bot and jumps directly to
    `status: WAITING_FOR_AGENT`, `mode: HUMAN`. There is no WebSocket
    frame type for this action, so it is REST-only.

    **No status guard exists.** An earlier revision of this document
    claimed reopening a session that is not `CLOSED` returns
    `400 VALIDATION_FAILED`. **That is not implemented.**
    `reopenSession` (`chat-session.service.ts:358-380`) applies no
    status check at all — it unconditionally applies the
    `WAITING_FOR_AGENT`/`HUMAN` transition to whatever status the
    target session is currently in.

    **Convergence behavior (real, and worth documenting precisely):** if
    the caller's (tenantId, customerId) already has a *different* active
    session, this endpoint does not reopen the requested one at all — it
    returns that other, already-active session's `{id, status, mode}`
    unchanged (`chat-session.service.ts:364-371`). This is the actual
    mechanism behind \"reopening a stale session is safe,\" not a
    request-level idempotency key.

    **`Idempotency-Key` is not implemented** — see \"Idempotency\" above;
    removed from this operation's parameters.

    **Response shape corrected**: the actual `200` body is
    `SessionMutationResult` (`{sessionId, status, mode}`, raw integer
    codes) — **not** the full `ChatSession` this operation previously
    promised (`chat.routes.ts:310-313`).

    **`@dhaam-ccrm/rest` performs a follow-up fetch**, for the same
    reason and in the same way documented on
    `POST /chat/sessions/{sessionId}/close` above: `SessionActions
    .reopenSession` needs the full `ChatSession`, so the adapter calls
    this endpoint and then `GET /chat/sessions/{sessionId}/full` — using
    whichever `id` this response actually returns, which per the
    convergence behavior above may not be the `sessionId` the caller
    requested. This is now implemented, not a proposal.

    Args:
        session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, ReopenSessionResponse200]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
        )
    ).parsed
