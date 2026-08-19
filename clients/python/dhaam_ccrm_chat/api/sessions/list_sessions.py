from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.session_summary_page import SessionSummaryPage
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: Union[Unset, int] = 20,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/sessions",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, SessionSummaryPage]]:
    if response.status_code == 200:
        response_200 = SessionSummaryPage.from_dict(response.json())

        return response_200

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
) -> Response[Union[Error, SessionSummaryPage]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 20,
) -> Response[Union[Error, SessionSummaryPage]]:
    """List the authenticated customer's recent sessions.

     Hydrates `ChatState.pastSessions` (PRD §6.4), which the PRD
    specifies as state but never gave a data source — this endpoint
    closes that gap.

    Replaces v1's `GET /chat/sessions/customer?tenantId=&customerId=`
    (`src/context.tsx:923`). That shape is not carried forward: taking
    `customerId` as a query parameter means the endpoint trusts the
    caller to declare whose sessions to return, so any customer could
    enumerate another's history by changing one parameter. Here both
    tenant and customer identity are derived from the validated
    `accessToken` and publishable key, and are not accepted as inputs.

    Ordered most-recent-first. Includes closed sessions — a customer
    reopening an earlier conversation (PRD §12.5) needs to see them.

    Args:
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, SessionSummaryPage]]
    """

    kwargs = _get_kwargs(
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 20,
) -> Optional[Union[Error, SessionSummaryPage]]:
    """List the authenticated customer's recent sessions.

     Hydrates `ChatState.pastSessions` (PRD §6.4), which the PRD
    specifies as state but never gave a data source — this endpoint
    closes that gap.

    Replaces v1's `GET /chat/sessions/customer?tenantId=&customerId=`
    (`src/context.tsx:923`). That shape is not carried forward: taking
    `customerId` as a query parameter means the endpoint trusts the
    caller to declare whose sessions to return, so any customer could
    enumerate another's history by changing one parameter. Here both
    tenant and customer identity are derived from the validated
    `accessToken` and publishable key, and are not accepted as inputs.

    Ordered most-recent-first. Includes closed sessions — a customer
    reopening an earlier conversation (PRD §12.5) needs to see them.

    Args:
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, SessionSummaryPage]
    """

    return sync_detailed(
        client=client,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 20,
) -> Response[Union[Error, SessionSummaryPage]]:
    """List the authenticated customer's recent sessions.

     Hydrates `ChatState.pastSessions` (PRD §6.4), which the PRD
    specifies as state but never gave a data source — this endpoint
    closes that gap.

    Replaces v1's `GET /chat/sessions/customer?tenantId=&customerId=`
    (`src/context.tsx:923`). That shape is not carried forward: taking
    `customerId` as a query parameter means the endpoint trusts the
    caller to declare whose sessions to return, so any customer could
    enumerate another's history by changing one parameter. Here both
    tenant and customer identity are derived from the validated
    `accessToken` and publishable key, and are not accepted as inputs.

    Ordered most-recent-first. Includes closed sessions — a customer
    reopening an earlier conversation (PRD §12.5) needs to see them.

    Args:
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, SessionSummaryPage]]
    """

    kwargs = _get_kwargs(
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 20,
) -> Optional[Union[Error, SessionSummaryPage]]:
    """List the authenticated customer's recent sessions.

     Hydrates `ChatState.pastSessions` (PRD §6.4), which the PRD
    specifies as state but never gave a data source — this endpoint
    closes that gap.

    Replaces v1's `GET /chat/sessions/customer?tenantId=&customerId=`
    (`src/context.tsx:923`). That shape is not carried forward: taking
    `customerId` as a query parameter means the endpoint trusts the
    caller to declare whose sessions to return, so any customer could
    enumerate another's history by changing one parameter. Here both
    tenant and customer identity are derived from the validated
    `accessToken` and publishable key, and are not accepted as inputs.

    Ordered most-recent-first. Includes closed sessions — a customer
    reopening an earlier conversation (PRD §12.5) needs to see them.

    Args:
        limit (Union[Unset, int]):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, SessionSummaryPage]
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
        )
    ).parsed
