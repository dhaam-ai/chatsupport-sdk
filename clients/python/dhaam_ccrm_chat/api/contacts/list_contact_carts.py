import datetime
from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.contacts_error import ContactsError
from ...models.list_contact_carts_response_200 import ListContactCartsResponse200
from ...models.list_contact_carts_sort import ListContactCartsSort
from ...models.list_contact_carts_status import ListContactCartsStatus
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    status: Union[Unset, ListContactCartsStatus] = ListContactCartsStatus.ABANDONED,
    min_value: Union[Unset, float] = UNSET,
    max_value: Union[Unset, float] = UNSET,
    updated_after: Union[Unset, datetime.datetime] = UNSET,
    updated_before: Union[Unset, datetime.datetime] = UNSET,
    page: Union[Unset, int] = 1,
    page_size: Union[Unset, int] = 25,
    sort: Union[Unset, ListContactCartsSort] = ListContactCartsSort.UPDATEDATDESC,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    json_status: Union[Unset, str] = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params["minValue"] = min_value

    params["maxValue"] = max_value

    json_updated_after: Union[Unset, str] = UNSET
    if not isinstance(updated_after, Unset):
        json_updated_after = updated_after.isoformat()
    params["updatedAfter"] = json_updated_after

    json_updated_before: Union[Unset, str] = UNSET
    if not isinstance(updated_before, Unset):
        json_updated_before = updated_before.isoformat()
    params["updatedBefore"] = json_updated_before

    params["page"] = page

    params["pageSize"] = page_size

    json_sort: Union[Unset, str] = UNSET
    if not isinstance(sort, Unset):
        json_sort = sort.value

    params["sort"] = json_sort

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/contacts/carts",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ContactsError, ListContactCartsResponse200]]:
    if response.status_code == 200:
        response_200 = ListContactCartsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ContactsError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ContactsError.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ContactsError.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = ContactsError.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[ContactsError, ListContactCartsResponse200]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    status: Union[Unset, ListContactCartsStatus] = ListContactCartsStatus.ABANDONED,
    min_value: Union[Unset, float] = UNSET,
    max_value: Union[Unset, float] = UNSET,
    updated_after: Union[Unset, datetime.datetime] = UNSET,
    updated_before: Union[Unset, datetime.datetime] = UNSET,
    page: Union[Unset, int] = 1,
    page_size: Union[Unset, int] = 25,
    sort: Union[Unset, ListContactCartsSort] = ListContactCartsSort.UPDATEDATDESC,
) -> Response[Union[ContactsError, ListContactCartsResponse200]]:
    r"""List/segment carts across the tenant's contacts (admin, win-back campaigns).

     The read side of the cart-segmentation use case — e.g. \"carts
    abandoned in the last 7 days worth $100+,\" to build a win-back
    audience. Every query, **including the total count**, carries the
    caller's own `tenantId` — the same rule `contact-list.service.ts`
    states for `GET /contacts`: a count that omitted it would leak the
    size of another tenant's cart segment through a number.

    `status` defaults to `abandoned` — segmentation, not a live-cart
    dashboard, is this operation's reason to exist.

    Args:
        status (Union[Unset, ListContactCartsStatus]):  Default: ListContactCartsStatus.ABANDONED.
        min_value (Union[Unset, float]):
        max_value (Union[Unset, float]):
        updated_after (Union[Unset, datetime.datetime]):
        updated_before (Union[Unset, datetime.datetime]):
        page (Union[Unset, int]):  Default: 1.
        page_size (Union[Unset, int]):  Default: 25.
        sort (Union[Unset, ListContactCartsSort]):  Default: ListContactCartsSort.UPDATEDATDESC.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ContactsError, ListContactCartsResponse200]]
    """

    kwargs = _get_kwargs(
        status=status,
        min_value=min_value,
        max_value=max_value,
        updated_after=updated_after,
        updated_before=updated_before,
        page=page,
        page_size=page_size,
        sort=sort,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    status: Union[Unset, ListContactCartsStatus] = ListContactCartsStatus.ABANDONED,
    min_value: Union[Unset, float] = UNSET,
    max_value: Union[Unset, float] = UNSET,
    updated_after: Union[Unset, datetime.datetime] = UNSET,
    updated_before: Union[Unset, datetime.datetime] = UNSET,
    page: Union[Unset, int] = 1,
    page_size: Union[Unset, int] = 25,
    sort: Union[Unset, ListContactCartsSort] = ListContactCartsSort.UPDATEDATDESC,
) -> Optional[Union[ContactsError, ListContactCartsResponse200]]:
    r"""List/segment carts across the tenant's contacts (admin, win-back campaigns).

     The read side of the cart-segmentation use case — e.g. \"carts
    abandoned in the last 7 days worth $100+,\" to build a win-back
    audience. Every query, **including the total count**, carries the
    caller's own `tenantId` — the same rule `contact-list.service.ts`
    states for `GET /contacts`: a count that omitted it would leak the
    size of another tenant's cart segment through a number.

    `status` defaults to `abandoned` — segmentation, not a live-cart
    dashboard, is this operation's reason to exist.

    Args:
        status (Union[Unset, ListContactCartsStatus]):  Default: ListContactCartsStatus.ABANDONED.
        min_value (Union[Unset, float]):
        max_value (Union[Unset, float]):
        updated_after (Union[Unset, datetime.datetime]):
        updated_before (Union[Unset, datetime.datetime]):
        page (Union[Unset, int]):  Default: 1.
        page_size (Union[Unset, int]):  Default: 25.
        sort (Union[Unset, ListContactCartsSort]):  Default: ListContactCartsSort.UPDATEDATDESC.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ContactsError, ListContactCartsResponse200]
    """

    return sync_detailed(
        client=client,
        status=status,
        min_value=min_value,
        max_value=max_value,
        updated_after=updated_after,
        updated_before=updated_before,
        page=page,
        page_size=page_size,
        sort=sort,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    status: Union[Unset, ListContactCartsStatus] = ListContactCartsStatus.ABANDONED,
    min_value: Union[Unset, float] = UNSET,
    max_value: Union[Unset, float] = UNSET,
    updated_after: Union[Unset, datetime.datetime] = UNSET,
    updated_before: Union[Unset, datetime.datetime] = UNSET,
    page: Union[Unset, int] = 1,
    page_size: Union[Unset, int] = 25,
    sort: Union[Unset, ListContactCartsSort] = ListContactCartsSort.UPDATEDATDESC,
) -> Response[Union[ContactsError, ListContactCartsResponse200]]:
    r"""List/segment carts across the tenant's contacts (admin, win-back campaigns).

     The read side of the cart-segmentation use case — e.g. \"carts
    abandoned in the last 7 days worth $100+,\" to build a win-back
    audience. Every query, **including the total count**, carries the
    caller's own `tenantId` — the same rule `contact-list.service.ts`
    states for `GET /contacts`: a count that omitted it would leak the
    size of another tenant's cart segment through a number.

    `status` defaults to `abandoned` — segmentation, not a live-cart
    dashboard, is this operation's reason to exist.

    Args:
        status (Union[Unset, ListContactCartsStatus]):  Default: ListContactCartsStatus.ABANDONED.
        min_value (Union[Unset, float]):
        max_value (Union[Unset, float]):
        updated_after (Union[Unset, datetime.datetime]):
        updated_before (Union[Unset, datetime.datetime]):
        page (Union[Unset, int]):  Default: 1.
        page_size (Union[Unset, int]):  Default: 25.
        sort (Union[Unset, ListContactCartsSort]):  Default: ListContactCartsSort.UPDATEDATDESC.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ContactsError, ListContactCartsResponse200]]
    """

    kwargs = _get_kwargs(
        status=status,
        min_value=min_value,
        max_value=max_value,
        updated_after=updated_after,
        updated_before=updated_before,
        page=page,
        page_size=page_size,
        sort=sort,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    status: Union[Unset, ListContactCartsStatus] = ListContactCartsStatus.ABANDONED,
    min_value: Union[Unset, float] = UNSET,
    max_value: Union[Unset, float] = UNSET,
    updated_after: Union[Unset, datetime.datetime] = UNSET,
    updated_before: Union[Unset, datetime.datetime] = UNSET,
    page: Union[Unset, int] = 1,
    page_size: Union[Unset, int] = 25,
    sort: Union[Unset, ListContactCartsSort] = ListContactCartsSort.UPDATEDATDESC,
) -> Optional[Union[ContactsError, ListContactCartsResponse200]]:
    r"""List/segment carts across the tenant's contacts (admin, win-back campaigns).

     The read side of the cart-segmentation use case — e.g. \"carts
    abandoned in the last 7 days worth $100+,\" to build a win-back
    audience. Every query, **including the total count**, carries the
    caller's own `tenantId` — the same rule `contact-list.service.ts`
    states for `GET /contacts`: a count that omitted it would leak the
    size of another tenant's cart segment through a number.

    `status` defaults to `abandoned` — segmentation, not a live-cart
    dashboard, is this operation's reason to exist.

    Args:
        status (Union[Unset, ListContactCartsStatus]):  Default: ListContactCartsStatus.ABANDONED.
        min_value (Union[Unset, float]):
        max_value (Union[Unset, float]):
        updated_after (Union[Unset, datetime.datetime]):
        updated_before (Union[Unset, datetime.datetime]):
        page (Union[Unset, int]):  Default: 1.
        page_size (Union[Unset, int]):  Default: 25.
        sort (Union[Unset, ListContactCartsSort]):  Default: ListContactCartsSort.UPDATEDATDESC.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ContactsError, ListContactCartsResponse200]
    """

    return (
        await asyncio_detailed(
            client=client,
            status=status,
            min_value=min_value,
            max_value=max_value,
            updated_after=updated_after,
            updated_before=updated_before,
            page=page,
            page_size=page_size,
            sort=sort,
        )
    ).parsed
