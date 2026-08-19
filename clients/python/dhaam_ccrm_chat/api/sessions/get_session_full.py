from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.session_full import SessionFull
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    limit: Union[Unset, int] = 20,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/sessions/{session_id}/full".format(
            session_id=session_id,
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, SessionFull]]:
    if response.status_code == 200:
        response_200 = SessionFull.from_dict(response.json())

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
) -> Response[Union[Error, SessionFull]]:
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
    limit: Union[Unset, int] = 20,
) -> Response[Union[Error, SessionFull]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10), which
    this spec confirms is the origin of the read-watermark model: each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).
    This is a read-only view of that watermark — see this document's
    top-level description for why there is no corresponding write
    endpoint here.

    `messages` is the most recent page (see `limit`), returned in
    ascending chronological order (oldest first). Use
    `GET /sessions/{sessionId}/messages` with `before` to page further
    back.

    Args:
        session_id (str):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, SessionFull]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
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
    limit: Union[Unset, int] = 20,
) -> Optional[Union[Error, SessionFull]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10), which
    this spec confirms is the origin of the read-watermark model: each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).
    This is a read-only view of that watermark — see this document's
    top-level description for why there is no corresponding write
    endpoint here.

    `messages` is the most recent page (see `limit`), returned in
    ascending chronological order (oldest first). Use
    `GET /sessions/{sessionId}/messages` with `before` to page further
    back.

    Args:
        session_id (str):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, SessionFull]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 20,
) -> Response[Union[Error, SessionFull]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10), which
    this spec confirms is the origin of the read-watermark model: each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).
    This is a read-only view of that watermark — see this document's
    top-level description for why there is no corresponding write
    endpoint here.

    `messages` is the most recent page (see `limit`), returned in
    ascending chronological order (oldest first). Use
    `GET /sessions/{sessionId}/messages` with `before` to page further
    back.

    Args:
        session_id (str):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, SessionFull]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 20,
) -> Optional[Union[Error, SessionFull]]:
    r"""Fetch full session state — session, participants (with read watermarks), and the most recent page of
    messages.

     Generalizes v1's `GET /sessions/{id}/full` (PRD §12.9, §12.10), which
    this spec confirms is the origin of the read-watermark model: each
    entry in `participants[]` carries `lastReadAt`, and a customer
    widget seeds its \"seen\" UI from the **maximum** `lastReadAt` across
    all `AGENT` participants (defending against multi-agent sessions).
    This is a read-only view of that watermark — see this document's
    top-level description for why there is no corresponding write
    endpoint here.

    `messages` is the most recent page (see `limit`), returned in
    ascending chronological order (oldest first). Use
    `GET /sessions/{sessionId}/messages` with `before` to page further
    back.

    Args:
        session_id (str):
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, SessionFull]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            limit=limit,
        )
    ).parsed
