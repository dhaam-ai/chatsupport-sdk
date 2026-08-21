from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.cart_abandoned_event import CartAbandonedEvent
from ...models.cart_converted_event import CartConvertedEvent
from ...models.cart_updated_event import CartUpdatedEvent
from ...models.contacts_error import ContactsError
from ...models.order_cancelled_event import OrderCancelledEvent
from ...models.order_completed_event import OrderCompletedEvent
from ...models.order_placed_event import OrderPlacedEvent
from ...models.record_commerce_event_response_200 import RecordCommerceEventResponse200
from ...types import Response


def _get_kwargs(
    *,
    body: Union[
        "CartAbandonedEvent",
        "CartConvertedEvent",
        "CartUpdatedEvent",
        "OrderCancelledEvent",
        "OrderCompletedEvent",
        "OrderPlacedEvent",
    ],
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/contacts/commerce-events",
    }

    _kwargs["json"]: dict[str, Any]
    if isinstance(body, OrderPlacedEvent):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, OrderCompletedEvent):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, OrderCancelledEvent):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, CartUpdatedEvent):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, CartAbandonedEvent):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ContactsError, RecordCommerceEventResponse200]]:
    if response.status_code == 200:
        response_200 = RecordCommerceEventResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ContactsError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ContactsError.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ContactsError.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = ContactsError.from_dict(response.json())

        return response_422

    if response.status_code == 429:
        response_429 = ContactsError.from_dict(response.json())

        return response_429

    if response.status_code == 500:
        response_500 = ContactsError.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[ContactsError, RecordCommerceEventResponse200]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEvent",
        "CartConvertedEvent",
        "CartUpdatedEvent",
        "OrderCancelledEvent",
        "OrderCompletedEvent",
        "OrderPlacedEvent",
    ],
) -> Response[Union[ContactsError, RecordCommerceEventResponse200]]:
    r"""Record a merchant order or cart event for one of their customers (machine, server-to-server).

     Called by the **merchant's own commerce backend** with their
    tenant secret key — the same credential and calling pattern
    `POST /tokens` already uses, never a browser. The target contact
    is resolved-or-created from the body's `customerId`; the tenant
    itself comes from the verified key, never from the body — there
    is no `tenantId` field anywhere in this request.

    Six event types, discriminated on `type` — see `CommerceEvent`.
    The server derives every `Contact` aggregate (`totalOrders`,
    `completedOrders`, `totalSpend`, `averageOrderValue`,
    `itemsInCart`/`cartValue`, `lastOrderMerchant`/`lastOrderCategory`/
    `lastOrderAt`) from the event stream; this call never sends a
    computed total.

    **`200`, never `201`**, for both a first acceptance and a replay
    of an already-applied event — this is a command over an event
    stream, not creation of a REST resource, and using one status
    code for both `applied` states avoids a status-code-encodes-
    idempotency-state trap. See \"Idempotency, and rejection recovery\"
    in this document's top-level description for the full contract,
    including what happens when the SAME `eventId` is retried after a
    `404`/`422` rejection (short answer: it is processed fresh, not
    short-circuited — the transaction that rejected it rolled back
    the idempotency row along with everything else).

    Request bodies up to 1 MiB are accepted — see \"Request size\" in
    the top-level description for why this is larger than
    `POST /tokens`'s limit.

    Not reachable via `@dhaam-ccrm/node`'s `UserScopedClient` — only
    `ChatServerClient.recordCommerceEvent()`, alongside `mintToken`,
    holds the secret key this route requires.

    Args:
        body (Union['CartAbandonedEvent', 'CartConvertedEvent', 'CartUpdatedEvent',
            'OrderCancelledEvent', 'OrderCompletedEvent', 'OrderPlacedEvent']): Discriminated union on
            `type`, one of the six order/cart events. This is the machine-path (secret-key) request
            shape — `customerId` is required on every variant. Mirrors `@dhaam-ccrm/node`'s
            `CommerceEvent` union (`packages/node/src/types.ts`) field-for-field.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ContactsError, RecordCommerceEventResponse200]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEvent",
        "CartConvertedEvent",
        "CartUpdatedEvent",
        "OrderCancelledEvent",
        "OrderCompletedEvent",
        "OrderPlacedEvent",
    ],
) -> Optional[Union[ContactsError, RecordCommerceEventResponse200]]:
    r"""Record a merchant order or cart event for one of their customers (machine, server-to-server).

     Called by the **merchant's own commerce backend** with their
    tenant secret key — the same credential and calling pattern
    `POST /tokens` already uses, never a browser. The target contact
    is resolved-or-created from the body's `customerId`; the tenant
    itself comes from the verified key, never from the body — there
    is no `tenantId` field anywhere in this request.

    Six event types, discriminated on `type` — see `CommerceEvent`.
    The server derives every `Contact` aggregate (`totalOrders`,
    `completedOrders`, `totalSpend`, `averageOrderValue`,
    `itemsInCart`/`cartValue`, `lastOrderMerchant`/`lastOrderCategory`/
    `lastOrderAt`) from the event stream; this call never sends a
    computed total.

    **`200`, never `201`**, for both a first acceptance and a replay
    of an already-applied event — this is a command over an event
    stream, not creation of a REST resource, and using one status
    code for both `applied` states avoids a status-code-encodes-
    idempotency-state trap. See \"Idempotency, and rejection recovery\"
    in this document's top-level description for the full contract,
    including what happens when the SAME `eventId` is retried after a
    `404`/`422` rejection (short answer: it is processed fresh, not
    short-circuited — the transaction that rejected it rolled back
    the idempotency row along with everything else).

    Request bodies up to 1 MiB are accepted — see \"Request size\" in
    the top-level description for why this is larger than
    `POST /tokens`'s limit.

    Not reachable via `@dhaam-ccrm/node`'s `UserScopedClient` — only
    `ChatServerClient.recordCommerceEvent()`, alongside `mintToken`,
    holds the secret key this route requires.

    Args:
        body (Union['CartAbandonedEvent', 'CartConvertedEvent', 'CartUpdatedEvent',
            'OrderCancelledEvent', 'OrderCompletedEvent', 'OrderPlacedEvent']): Discriminated union on
            `type`, one of the six order/cart events. This is the machine-path (secret-key) request
            shape — `customerId` is required on every variant. Mirrors `@dhaam-ccrm/node`'s
            `CommerceEvent` union (`packages/node/src/types.ts`) field-for-field.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ContactsError, RecordCommerceEventResponse200]
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEvent",
        "CartConvertedEvent",
        "CartUpdatedEvent",
        "OrderCancelledEvent",
        "OrderCompletedEvent",
        "OrderPlacedEvent",
    ],
) -> Response[Union[ContactsError, RecordCommerceEventResponse200]]:
    r"""Record a merchant order or cart event for one of their customers (machine, server-to-server).

     Called by the **merchant's own commerce backend** with their
    tenant secret key — the same credential and calling pattern
    `POST /tokens` already uses, never a browser. The target contact
    is resolved-or-created from the body's `customerId`; the tenant
    itself comes from the verified key, never from the body — there
    is no `tenantId` field anywhere in this request.

    Six event types, discriminated on `type` — see `CommerceEvent`.
    The server derives every `Contact` aggregate (`totalOrders`,
    `completedOrders`, `totalSpend`, `averageOrderValue`,
    `itemsInCart`/`cartValue`, `lastOrderMerchant`/`lastOrderCategory`/
    `lastOrderAt`) from the event stream; this call never sends a
    computed total.

    **`200`, never `201`**, for both a first acceptance and a replay
    of an already-applied event — this is a command over an event
    stream, not creation of a REST resource, and using one status
    code for both `applied` states avoids a status-code-encodes-
    idempotency-state trap. See \"Idempotency, and rejection recovery\"
    in this document's top-level description for the full contract,
    including what happens when the SAME `eventId` is retried after a
    `404`/`422` rejection (short answer: it is processed fresh, not
    short-circuited — the transaction that rejected it rolled back
    the idempotency row along with everything else).

    Request bodies up to 1 MiB are accepted — see \"Request size\" in
    the top-level description for why this is larger than
    `POST /tokens`'s limit.

    Not reachable via `@dhaam-ccrm/node`'s `UserScopedClient` — only
    `ChatServerClient.recordCommerceEvent()`, alongside `mintToken`,
    holds the secret key this route requires.

    Args:
        body (Union['CartAbandonedEvent', 'CartConvertedEvent', 'CartUpdatedEvent',
            'OrderCancelledEvent', 'OrderCompletedEvent', 'OrderPlacedEvent']): Discriminated union on
            `type`, one of the six order/cart events. This is the machine-path (secret-key) request
            shape — `customerId` is required on every variant. Mirrors `@dhaam-ccrm/node`'s
            `CommerceEvent` union (`packages/node/src/types.ts`) field-for-field.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ContactsError, RecordCommerceEventResponse200]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEvent",
        "CartConvertedEvent",
        "CartUpdatedEvent",
        "OrderCancelledEvent",
        "OrderCompletedEvent",
        "OrderPlacedEvent",
    ],
) -> Optional[Union[ContactsError, RecordCommerceEventResponse200]]:
    r"""Record a merchant order or cart event for one of their customers (machine, server-to-server).

     Called by the **merchant's own commerce backend** with their
    tenant secret key — the same credential and calling pattern
    `POST /tokens` already uses, never a browser. The target contact
    is resolved-or-created from the body's `customerId`; the tenant
    itself comes from the verified key, never from the body — there
    is no `tenantId` field anywhere in this request.

    Six event types, discriminated on `type` — see `CommerceEvent`.
    The server derives every `Contact` aggregate (`totalOrders`,
    `completedOrders`, `totalSpend`, `averageOrderValue`,
    `itemsInCart`/`cartValue`, `lastOrderMerchant`/`lastOrderCategory`/
    `lastOrderAt`) from the event stream; this call never sends a
    computed total.

    **`200`, never `201`**, for both a first acceptance and a replay
    of an already-applied event — this is a command over an event
    stream, not creation of a REST resource, and using one status
    code for both `applied` states avoids a status-code-encodes-
    idempotency-state trap. See \"Idempotency, and rejection recovery\"
    in this document's top-level description for the full contract,
    including what happens when the SAME `eventId` is retried after a
    `404`/`422` rejection (short answer: it is processed fresh, not
    short-circuited — the transaction that rejected it rolled back
    the idempotency row along with everything else).

    Request bodies up to 1 MiB are accepted — see \"Request size\" in
    the top-level description for why this is larger than
    `POST /tokens`'s limit.

    Not reachable via `@dhaam-ccrm/node`'s `UserScopedClient` — only
    `ChatServerClient.recordCommerceEvent()`, alongside `mintToken`,
    holds the secret key this route requires.

    Args:
        body (Union['CartAbandonedEvent', 'CartConvertedEvent', 'CartUpdatedEvent',
            'OrderCancelledEvent', 'OrderCompletedEvent', 'OrderPlacedEvent']): Discriminated union on
            `type`, one of the six order/cart events. This is the machine-path (secret-key) request
            shape — `customerId` is required on every variant. Mirrors `@dhaam-ccrm/node`'s
            `CommerceEvent` union (`packages/node/src/types.ts`) field-for-field.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ContactsError, RecordCommerceEventResponse200]
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
