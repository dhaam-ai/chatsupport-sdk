from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.message_page import MessagePage
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    before: Union[Unset, str] = UNSET,
    limit: Union[Unset, int] = 20,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["before"] = before

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/sessions/{session_id}/messages".format(
            session_id=session_id,
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, MessagePage]]:
    if response.status_code == 200:
        response_200 = MessagePage.from_dict(response.json())

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
) -> Response[Union[Error, MessagePage]]:
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
    limit: Union[Unset, int] = 20,
) -> Response[Union[Error, MessagePage]]:
    """Cursor-paginated message history, walking backward from a given message.

     Matches v1's proven pagination shape exactly (PRD §12.10, §6.3):
    opaque-id backward cursor (`before`), a `limit`, and a `hasMore`
    boolean in the response. There is no forward cursor — live messages
    arrive over the WebSocket (`message.new`, T1), not by polling this
    endpoint. Omit `before` to fetch the most recent page (equivalent to
    the first page a scroll-up pagination UI would request).

    Returned in ascending chronological order (oldest first) — the
    oldest message in the response is the one immediately following the
    given `before` cursor, so a client can prepend the page to its
    existing message list without re-sorting.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, MessagePage]]
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
    limit: Union[Unset, int] = 20,
) -> Optional[Union[Error, MessagePage]]:
    """Cursor-paginated message history, walking backward from a given message.

     Matches v1's proven pagination shape exactly (PRD §12.10, §6.3):
    opaque-id backward cursor (`before`), a `limit`, and a `hasMore`
    boolean in the response. There is no forward cursor — live messages
    arrive over the WebSocket (`message.new`, T1), not by polling this
    endpoint. Omit `before` to fetch the most recent page (equivalent to
    the first page a scroll-up pagination UI would request).

    Returned in ascending chronological order (oldest first) — the
    oldest message in the response is the one immediately following the
    given `before` cursor, so a client can prepend the page to its
    existing message list without re-sorting.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, MessagePage]
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
    limit: Union[Unset, int] = 20,
) -> Response[Union[Error, MessagePage]]:
    """Cursor-paginated message history, walking backward from a given message.

     Matches v1's proven pagination shape exactly (PRD §12.10, §6.3):
    opaque-id backward cursor (`before`), a `limit`, and a `hasMore`
    boolean in the response. There is no forward cursor — live messages
    arrive over the WebSocket (`message.new`, T1), not by polling this
    endpoint. Omit `before` to fetch the most recent page (equivalent to
    the first page a scroll-up pagination UI would request).

    Returned in ascending chronological order (oldest first) — the
    oldest message in the response is the one immediately following the
    given `before` cursor, so a client can prepend the page to its
    existing message list without re-sorting.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, MessagePage]]
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
    limit: Union[Unset, int] = 20,
) -> Optional[Union[Error, MessagePage]]:
    """Cursor-paginated message history, walking backward from a given message.

     Matches v1's proven pagination shape exactly (PRD §12.10, §6.3):
    opaque-id backward cursor (`before`), a `limit`, and a `hasMore`
    boolean in the response. There is no forward cursor — live messages
    arrive over the WebSocket (`message.new`, T1), not by polling this
    endpoint. Omit `before` to fetch the most recent page (equivalent to
    the first page a scroll-up pagination UI would request).

    Returned in ascending chronological order (oldest first) — the
    oldest message in the response is the one immediately following the
    given `before` cursor, so a client can prepend the page to its
    existing message list without re-sorting.

    Args:
        session_id (str):
        before (Union[Unset, str]):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, MessagePage]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            before=before,
            limit=limit,
        )
    ).parsed
