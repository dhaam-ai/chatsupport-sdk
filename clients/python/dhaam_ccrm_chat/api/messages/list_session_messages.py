from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.list_session_messages_response_200 import ListSessionMessagesResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    before: Union[Unset, str] = UNSET,
    limit: Union[Unset, int] = 30,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["before"] = before

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/chat/sessions/{session_id}/messages".format(
            session_id=session_id,
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, ListSessionMessagesResponse200]]:
    if response.status_code == 200:
        response_200 = ListSessionMessagesResponse200.from_dict(response.json())

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
) -> Response[Union[Error, ListSessionMessagesResponse200]]:
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
    before: Union[Unset, str] = UNSET,
    limit: Union[Unset, int] = 30,
) -> Response[Union[Error, ListSessionMessagesResponse200]]:
    r"""Cursor-paginated message history, walking backward from a given message.

     **Path corrected**: `GET /chat/sessions/{sessionId}/messages`
    (`chat.routes.ts:262`). This is the endpoint at the center of the
    \"message history not appearing after reload\" defect this
    correction pass exists to close — see `ChatMessageWire` below for
    exactly what it returns and why an earlier version of
    `@dhaam-ccrm/rest` could not render it correctly even once the path
    itself was fixed.

    Matches v1's proven pagination shape (PRD §12.10, §6.3): opaque-id
    backward cursor (`before`), a `limit`, and a `hasMore` boolean in
    the response — confirmed unchanged from this document's original
    design (`listMessagesQuerySchema`, `chat.validator.ts:39-42`).
    There is no forward cursor — live messages arrive over the
    WebSocket (`message.new`), not by polling this endpoint. Omit
    `before` to fetch the most recent page.

    Returned in ascending chronological order (oldest first) —
    confirmed: the repository queries `createdAt desc` and the service
    reverses the slice before returning it
    (`message.repository.ts:174-187`, `message.service.ts:290`) — so
    the oldest message in the response is the one immediately following
    the given `before` cursor, and a client can prepend the page
    without re-sorting.

    **Message shape corrected**: the response's `messages[]` is
    `ChatMessageWire`, not the normalized `ChatMessage`. Two concrete
    deviations, both confirmed against `message.service.ts:285-296`
    and `:470-482` (`getMessages`/`getMessagesPaginated`, which return
    Prisma rows verbatim — neither method touches `metadata` or
    converts an enum):

    1. `senderType` and `messageType` are raw integer codes
       (`shared/constants/enums.ts:29-44`), not string enum names. Only
       the WebSocket path's `projectMessage`
       (`api/websocket/v2/projection.ts:81-82,205-206`) converts these;
       this REST path never does.
    2. `attachment` is never present at the top level. When a message
       carries one, it is nested at `metadata.attachment`
       (`api/websocket/v2/projection.ts:213-220`'s own comment: \"the
       database keeps attachments inside the legacy `metadata`
       column\" — that comment describes the persistence layer this
       REST path reads from directly, unprojected).

    `@dhaam-ccrm/rest`'s `createHistorySource` adapter converts every
    row of this shape into the normalized `ChatMessage` (int→string
    lookup, and lifting/stripping `metadata.attachment`) before handing
    it to `@dhaam-ccrm/core` — this is now implemented (see
    `packages/rest/src/projection.ts`). This schema exists so that
    normalization step stays visible and is never \"corrected\" back out
    under the assumption that the wire already matches `ChatMessage`.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 30.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, ListSessionMessagesResponse200]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        before=before,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    before: Union[Unset, str] = UNSET,
    limit: Union[Unset, int] = 30,
) -> Optional[Union[Error, ListSessionMessagesResponse200]]:
    r"""Cursor-paginated message history, walking backward from a given message.

     **Path corrected**: `GET /chat/sessions/{sessionId}/messages`
    (`chat.routes.ts:262`). This is the endpoint at the center of the
    \"message history not appearing after reload\" defect this
    correction pass exists to close — see `ChatMessageWire` below for
    exactly what it returns and why an earlier version of
    `@dhaam-ccrm/rest` could not render it correctly even once the path
    itself was fixed.

    Matches v1's proven pagination shape (PRD §12.10, §6.3): opaque-id
    backward cursor (`before`), a `limit`, and a `hasMore` boolean in
    the response — confirmed unchanged from this document's original
    design (`listMessagesQuerySchema`, `chat.validator.ts:39-42`).
    There is no forward cursor — live messages arrive over the
    WebSocket (`message.new`), not by polling this endpoint. Omit
    `before` to fetch the most recent page.

    Returned in ascending chronological order (oldest first) —
    confirmed: the repository queries `createdAt desc` and the service
    reverses the slice before returning it
    (`message.repository.ts:174-187`, `message.service.ts:290`) — so
    the oldest message in the response is the one immediately following
    the given `before` cursor, and a client can prepend the page
    without re-sorting.

    **Message shape corrected**: the response's `messages[]` is
    `ChatMessageWire`, not the normalized `ChatMessage`. Two concrete
    deviations, both confirmed against `message.service.ts:285-296`
    and `:470-482` (`getMessages`/`getMessagesPaginated`, which return
    Prisma rows verbatim — neither method touches `metadata` or
    converts an enum):

    1. `senderType` and `messageType` are raw integer codes
       (`shared/constants/enums.ts:29-44`), not string enum names. Only
       the WebSocket path's `projectMessage`
       (`api/websocket/v2/projection.ts:81-82,205-206`) converts these;
       this REST path never does.
    2. `attachment` is never present at the top level. When a message
       carries one, it is nested at `metadata.attachment`
       (`api/websocket/v2/projection.ts:213-220`'s own comment: \"the
       database keeps attachments inside the legacy `metadata`
       column\" — that comment describes the persistence layer this
       REST path reads from directly, unprojected).

    `@dhaam-ccrm/rest`'s `createHistorySource` adapter converts every
    row of this shape into the normalized `ChatMessage` (int→string
    lookup, and lifting/stripping `metadata.attachment`) before handing
    it to `@dhaam-ccrm/core` — this is now implemented (see
    `packages/rest/src/projection.ts`). This schema exists so that
    normalization step stays visible and is never \"corrected\" back out
    under the assumption that the wire already matches `ChatMessage`.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 30.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, ListSessionMessagesResponse200]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        before=before,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    before: Union[Unset, str] = UNSET,
    limit: Union[Unset, int] = 30,
) -> Response[Union[Error, ListSessionMessagesResponse200]]:
    r"""Cursor-paginated message history, walking backward from a given message.

     **Path corrected**: `GET /chat/sessions/{sessionId}/messages`
    (`chat.routes.ts:262`). This is the endpoint at the center of the
    \"message history not appearing after reload\" defect this
    correction pass exists to close — see `ChatMessageWire` below for
    exactly what it returns and why an earlier version of
    `@dhaam-ccrm/rest` could not render it correctly even once the path
    itself was fixed.

    Matches v1's proven pagination shape (PRD §12.10, §6.3): opaque-id
    backward cursor (`before`), a `limit`, and a `hasMore` boolean in
    the response — confirmed unchanged from this document's original
    design (`listMessagesQuerySchema`, `chat.validator.ts:39-42`).
    There is no forward cursor — live messages arrive over the
    WebSocket (`message.new`), not by polling this endpoint. Omit
    `before` to fetch the most recent page.

    Returned in ascending chronological order (oldest first) —
    confirmed: the repository queries `createdAt desc` and the service
    reverses the slice before returning it
    (`message.repository.ts:174-187`, `message.service.ts:290`) — so
    the oldest message in the response is the one immediately following
    the given `before` cursor, and a client can prepend the page
    without re-sorting.

    **Message shape corrected**: the response's `messages[]` is
    `ChatMessageWire`, not the normalized `ChatMessage`. Two concrete
    deviations, both confirmed against `message.service.ts:285-296`
    and `:470-482` (`getMessages`/`getMessagesPaginated`, which return
    Prisma rows verbatim — neither method touches `metadata` or
    converts an enum):

    1. `senderType` and `messageType` are raw integer codes
       (`shared/constants/enums.ts:29-44`), not string enum names. Only
       the WebSocket path's `projectMessage`
       (`api/websocket/v2/projection.ts:81-82,205-206`) converts these;
       this REST path never does.
    2. `attachment` is never present at the top level. When a message
       carries one, it is nested at `metadata.attachment`
       (`api/websocket/v2/projection.ts:213-220`'s own comment: \"the
       database keeps attachments inside the legacy `metadata`
       column\" — that comment describes the persistence layer this
       REST path reads from directly, unprojected).

    `@dhaam-ccrm/rest`'s `createHistorySource` adapter converts every
    row of this shape into the normalized `ChatMessage` (int→string
    lookup, and lifting/stripping `metadata.attachment`) before handing
    it to `@dhaam-ccrm/core` — this is now implemented (see
    `packages/rest/src/projection.ts`). This schema exists so that
    normalization step stays visible and is never \"corrected\" back out
    under the assumption that the wire already matches `ChatMessage`.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 30.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, ListSessionMessagesResponse200]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        before=before,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    before: Union[Unset, str] = UNSET,
    limit: Union[Unset, int] = 30,
) -> Optional[Union[Error, ListSessionMessagesResponse200]]:
    r"""Cursor-paginated message history, walking backward from a given message.

     **Path corrected**: `GET /chat/sessions/{sessionId}/messages`
    (`chat.routes.ts:262`). This is the endpoint at the center of the
    \"message history not appearing after reload\" defect this
    correction pass exists to close — see `ChatMessageWire` below for
    exactly what it returns and why an earlier version of
    `@dhaam-ccrm/rest` could not render it correctly even once the path
    itself was fixed.

    Matches v1's proven pagination shape (PRD §12.10, §6.3): opaque-id
    backward cursor (`before`), a `limit`, and a `hasMore` boolean in
    the response — confirmed unchanged from this document's original
    design (`listMessagesQuerySchema`, `chat.validator.ts:39-42`).
    There is no forward cursor — live messages arrive over the
    WebSocket (`message.new`), not by polling this endpoint. Omit
    `before` to fetch the most recent page.

    Returned in ascending chronological order (oldest first) —
    confirmed: the repository queries `createdAt desc` and the service
    reverses the slice before returning it
    (`message.repository.ts:174-187`, `message.service.ts:290`) — so
    the oldest message in the response is the one immediately following
    the given `before` cursor, and a client can prepend the page
    without re-sorting.

    **Message shape corrected**: the response's `messages[]` is
    `ChatMessageWire`, not the normalized `ChatMessage`. Two concrete
    deviations, both confirmed against `message.service.ts:285-296`
    and `:470-482` (`getMessages`/`getMessagesPaginated`, which return
    Prisma rows verbatim — neither method touches `metadata` or
    converts an enum):

    1. `senderType` and `messageType` are raw integer codes
       (`shared/constants/enums.ts:29-44`), not string enum names. Only
       the WebSocket path's `projectMessage`
       (`api/websocket/v2/projection.ts:81-82,205-206`) converts these;
       this REST path never does.
    2. `attachment` is never present at the top level. When a message
       carries one, it is nested at `metadata.attachment`
       (`api/websocket/v2/projection.ts:213-220`'s own comment: \"the
       database keeps attachments inside the legacy `metadata`
       column\" — that comment describes the persistence layer this
       REST path reads from directly, unprojected).

    `@dhaam-ccrm/rest`'s `createHistorySource` adapter converts every
    row of this shape into the normalized `ChatMessage` (int→string
    lookup, and lifting/stripping `metadata.attachment`) before handing
    it to `@dhaam-ccrm/core` — this is now implemented (see
    `packages/rest/src/projection.ts`). This schema exists so that
    normalization step stays visible and is never \"corrected\" back out
    under the assumption that the wire already matches `ChatMessage`.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 30.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, ListSessionMessagesResponse200]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            before=before,
            limit=limit,
        )
    ).parsed
