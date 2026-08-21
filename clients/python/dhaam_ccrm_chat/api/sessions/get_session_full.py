from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.get_session_full_response_200 import GetSessionFullResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    message_limit: Union[Unset, int] = 50,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["messageLimit"] = message_limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/chat/sessions/{session_id}/full".format(
            session_id=session_id,
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, GetSessionFullResponse200]]:
    if response.status_code == 200:
        response_200 = GetSessionFullResponse200.from_dict(response.json())

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
) -> Response[Union[Error, GetSessionFullResponse200]]:
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
    message_limit: Union[Unset, int] = 50,
) -> Response[Union[Error, GetSessionFullResponse200]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     **Path corrected**: `GET /chat/sessions/{sessionId}/full`
    (`chat.routes.ts:242`).

    Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10): each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).

    `messages` is the most recent page (see `messageLimit`), returned
    in ascending chronological order (oldest first). Use
    `GET /chat/sessions/{sessionId}/messages` with `before` to page
    further back.

    **Message shape corrected**: `messages[]` in the real response is
    `ChatMessageWire`, not the normalized `ChatMessage` — see that
    schema for the two concrete deviations (raw integer enum codes,
    unlifted `metadata.attachment`) and for how `@dhaam-ccrm/rest`
    normalizes them. `session`'s own `status`/`mode` are also raw
    integers on this path, and its `assignedAgent`/`customer` profile
    objects are missing `participantId`
    (`chat-user.service.ts:189-231`'s enrichment never sets it) — noted
    here as a known, separately-tracked gap not fully re-modeled in
    this revision.

    Args:
        session_id (str):
        message_limit (Union[Unset, int]):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, GetSessionFullResponse200]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        message_limit=message_limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    message_limit: Union[Unset, int] = 50,
) -> Optional[Union[Error, GetSessionFullResponse200]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     **Path corrected**: `GET /chat/sessions/{sessionId}/full`
    (`chat.routes.ts:242`).

    Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10): each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).

    `messages` is the most recent page (see `messageLimit`), returned
    in ascending chronological order (oldest first). Use
    `GET /chat/sessions/{sessionId}/messages` with `before` to page
    further back.

    **Message shape corrected**: `messages[]` in the real response is
    `ChatMessageWire`, not the normalized `ChatMessage` — see that
    schema for the two concrete deviations (raw integer enum codes,
    unlifted `metadata.attachment`) and for how `@dhaam-ccrm/rest`
    normalizes them. `session`'s own `status`/`mode` are also raw
    integers on this path, and its `assignedAgent`/`customer` profile
    objects are missing `participantId`
    (`chat-user.service.ts:189-231`'s enrichment never sets it) — noted
    here as a known, separately-tracked gap not fully re-modeled in
    this revision.

    Args:
        session_id (str):
        message_limit (Union[Unset, int]):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, GetSessionFullResponse200]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        message_limit=message_limit,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    message_limit: Union[Unset, int] = 50,
) -> Response[Union[Error, GetSessionFullResponse200]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     **Path corrected**: `GET /chat/sessions/{sessionId}/full`
    (`chat.routes.ts:242`).

    Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10): each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).

    `messages` is the most recent page (see `messageLimit`), returned
    in ascending chronological order (oldest first). Use
    `GET /chat/sessions/{sessionId}/messages` with `before` to page
    further back.

    **Message shape corrected**: `messages[]` in the real response is
    `ChatMessageWire`, not the normalized `ChatMessage` — see that
    schema for the two concrete deviations (raw integer enum codes,
    unlifted `metadata.attachment`) and for how `@dhaam-ccrm/rest`
    normalizes them. `session`'s own `status`/`mode` are also raw
    integers on this path, and its `assignedAgent`/`customer` profile
    objects are missing `participantId`
    (`chat-user.service.ts:189-231`'s enrichment never sets it) — noted
    here as a known, separately-tracked gap not fully re-modeled in
    this revision.

    Args:
        session_id (str):
        message_limit (Union[Unset, int]):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, GetSessionFullResponse200]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        message_limit=message_limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    message_limit: Union[Unset, int] = 50,
) -> Optional[Union[Error, GetSessionFullResponse200]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     **Path corrected**: `GET /chat/sessions/{sessionId}/full`
    (`chat.routes.ts:242`).

    Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10): each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).

    `messages` is the most recent page (see `messageLimit`), returned
    in ascending chronological order (oldest first). Use
    `GET /chat/sessions/{sessionId}/messages` with `before` to page
    further back.

    **Message shape corrected**: `messages[]` in the real response is
    `ChatMessageWire`, not the normalized `ChatMessage` — see that
    schema for the two concrete deviations (raw integer enum codes,
    unlifted `metadata.attachment`) and for how `@dhaam-ccrm/rest`
    normalizes them. `session`'s own `status`/`mode` are also raw
    integers on this path, and its `assignedAgent`/`customer` profile
    objects are missing `participantId`
    (`chat-user.service.ts:189-231`'s enrichment never sets it) — noted
    here as a known, separately-tracked gap not fully re-modeled in
    this revision.

    Args:
        session_id (str):
        message_limit (Union[Unset, int]):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, GetSessionFullResponse200]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            message_limit=message_limit,
        )
    ).parsed
