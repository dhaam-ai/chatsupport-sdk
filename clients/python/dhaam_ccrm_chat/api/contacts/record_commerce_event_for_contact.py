from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.cart_abandoned_event_admin import CartAbandonedEventAdmin
from ...models.cart_converted_event_admin import CartConvertedEventAdmin
from ...models.cart_updated_event_admin import CartUpdatedEventAdmin
from ...models.contacts_error import ContactsError
from ...models.order_cancelled_event_admin import OrderCancelledEventAdmin
from ...models.order_completed_event_admin import OrderCompletedEventAdmin
from ...models.order_placed_event_admin import OrderPlacedEventAdmin
from ...models.record_commerce_event_for_contact_response_200 import (
    RecordCommerceEventForContactResponse200,
)
from ...types import Response


def _get_kwargs(
    id: str,
    *,
    body: Union[
        "CartAbandonedEventAdmin",
        "CartConvertedEventAdmin",
        "CartUpdatedEventAdmin",
        "OrderCancelledEventAdmin",
        "OrderCompletedEventAdmin",
        "OrderPlacedEventAdmin",
    ],
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/contacts/{id}/commerce-events".format(
            id=id,
        ),
    }

    _kwargs["json"]: dict[str, Any]
    if isinstance(body, OrderPlacedEventAdmin):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, OrderCompletedEventAdmin):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, OrderCancelledEventAdmin):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, CartUpdatedEventAdmin):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, CartAbandonedEventAdmin):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ContactsError, RecordCommerceEventForContactResponse200]]:
    if response.status_code == 200:
        response_200 = RecordCommerceEventForContactResponse200.from_dict(
            response.json()
        )

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

    if response.status_code == 404:
        response_404 = ContactsError.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = ContactsError.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = ContactsError.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[ContactsError, RecordCommerceEventForContactResponse200]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEventAdmin",
        "CartConvertedEventAdmin",
        "CartUpdatedEventAdmin",
        "OrderCancelledEventAdmin",
        "OrderCompletedEventAdmin",
        "OrderPlacedEventAdmin",
    ],
) -> Response[Union[ContactsError, RecordCommerceEventForContactResponse200]]:
    r"""Record an order or cart correction for one contact (admin/CRM).

     The human counterpart to `recordCommerceEvent` — a tenant admin in
    the CRM correcting or backfilling what the machine feed missed or
    got wrong (a phone order, a manual backfill), through the
    identical event-shaped mechanism. Not a raw field-override: every
    write, machine or human, is an event the server derives aggregates
    from — there is no endpoint that sets e.g. `totalSpend` to an
    exact number directly.

    `:id` must already exist for the caller's own tenant — unlike the
    machine path, this path never creates a contact. A typo'd or
    cross-tenant `:id` is `404 CONTACT_NOT_FOUND`, never `403` — see
    `ContactsContactNotFound`.

    Same event taxonomy as `CommerceEvent`, minus `customerId` — see
    `CommerceEventAdmin`. Same `200`-always response shape, and the
    identical idempotency/rejection-recovery contract, as the machine
    path (see \"Idempotency, and rejection recovery\" above).

    Every event this path writes records the acting admin's identity
    for audit — \"who corrected this contact's order history\" is a
    support/compliance question a tenant will ask.

    Not exposed via `@dhaam-ccrm/node` — this is a CRM-console
    operation, not part of the merchant-facing SDK surface;
    `ChatServerClient` gains only the machine-path method.

    Args:
        id (str):
        body (Union['CartAbandonedEventAdmin', 'CartConvertedEventAdmin', 'CartUpdatedEventAdmin',
            'OrderCancelledEventAdmin', 'OrderCompletedEventAdmin', 'OrderPlacedEventAdmin']): The
            admin-path (staff-token) request shape for `POST /contacts/{id}/commerce-events` — field-
            for-field identical to `CommerceEvent` except `customerId` is absent from every variant.
            The target contact is named by `:id` in the path instead; supplying `customerId` in the
            body is a `400` (`.strict()` rejects the unrecognised field — it does not silently ignore
            it, so a caller cannot believe it retargeted the event and be wrong).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ContactsError, RecordCommerceEventForContactResponse200]]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEventAdmin",
        "CartConvertedEventAdmin",
        "CartUpdatedEventAdmin",
        "OrderCancelledEventAdmin",
        "OrderCompletedEventAdmin",
        "OrderPlacedEventAdmin",
    ],
) -> Optional[Union[ContactsError, RecordCommerceEventForContactResponse200]]:
    r"""Record an order or cart correction for one contact (admin/CRM).

     The human counterpart to `recordCommerceEvent` — a tenant admin in
    the CRM correcting or backfilling what the machine feed missed or
    got wrong (a phone order, a manual backfill), through the
    identical event-shaped mechanism. Not a raw field-override: every
    write, machine or human, is an event the server derives aggregates
    from — there is no endpoint that sets e.g. `totalSpend` to an
    exact number directly.

    `:id` must already exist for the caller's own tenant — unlike the
    machine path, this path never creates a contact. A typo'd or
    cross-tenant `:id` is `404 CONTACT_NOT_FOUND`, never `403` — see
    `ContactsContactNotFound`.

    Same event taxonomy as `CommerceEvent`, minus `customerId` — see
    `CommerceEventAdmin`. Same `200`-always response shape, and the
    identical idempotency/rejection-recovery contract, as the machine
    path (see \"Idempotency, and rejection recovery\" above).

    Every event this path writes records the acting admin's identity
    for audit — \"who corrected this contact's order history\" is a
    support/compliance question a tenant will ask.

    Not exposed via `@dhaam-ccrm/node` — this is a CRM-console
    operation, not part of the merchant-facing SDK surface;
    `ChatServerClient` gains only the machine-path method.

    Args:
        id (str):
        body (Union['CartAbandonedEventAdmin', 'CartConvertedEventAdmin', 'CartUpdatedEventAdmin',
            'OrderCancelledEventAdmin', 'OrderCompletedEventAdmin', 'OrderPlacedEventAdmin']): The
            admin-path (staff-token) request shape for `POST /contacts/{id}/commerce-events` — field-
            for-field identical to `CommerceEvent` except `customerId` is absent from every variant.
            The target contact is named by `:id` in the path instead; supplying `customerId` in the
            body is a `400` (`.strict()` rejects the unrecognised field — it does not silently ignore
            it, so a caller cannot believe it retargeted the event and be wrong).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ContactsError, RecordCommerceEventForContactResponse200]
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEventAdmin",
        "CartConvertedEventAdmin",
        "CartUpdatedEventAdmin",
        "OrderCancelledEventAdmin",
        "OrderCompletedEventAdmin",
        "OrderPlacedEventAdmin",
    ],
) -> Response[Union[ContactsError, RecordCommerceEventForContactResponse200]]:
    r"""Record an order or cart correction for one contact (admin/CRM).

     The human counterpart to `recordCommerceEvent` — a tenant admin in
    the CRM correcting or backfilling what the machine feed missed or
    got wrong (a phone order, a manual backfill), through the
    identical event-shaped mechanism. Not a raw field-override: every
    write, machine or human, is an event the server derives aggregates
    from — there is no endpoint that sets e.g. `totalSpend` to an
    exact number directly.

    `:id` must already exist for the caller's own tenant — unlike the
    machine path, this path never creates a contact. A typo'd or
    cross-tenant `:id` is `404 CONTACT_NOT_FOUND`, never `403` — see
    `ContactsContactNotFound`.

    Same event taxonomy as `CommerceEvent`, minus `customerId` — see
    `CommerceEventAdmin`. Same `200`-always response shape, and the
    identical idempotency/rejection-recovery contract, as the machine
    path (see \"Idempotency, and rejection recovery\" above).

    Every event this path writes records the acting admin's identity
    for audit — \"who corrected this contact's order history\" is a
    support/compliance question a tenant will ask.

    Not exposed via `@dhaam-ccrm/node` — this is a CRM-console
    operation, not part of the merchant-facing SDK surface;
    `ChatServerClient` gains only the machine-path method.

    Args:
        id (str):
        body (Union['CartAbandonedEventAdmin', 'CartConvertedEventAdmin', 'CartUpdatedEventAdmin',
            'OrderCancelledEventAdmin', 'OrderCompletedEventAdmin', 'OrderPlacedEventAdmin']): The
            admin-path (staff-token) request shape for `POST /contacts/{id}/commerce-events` — field-
            for-field identical to `CommerceEvent` except `customerId` is absent from every variant.
            The target contact is named by `:id` in the path instead; supplying `customerId` in the
            body is a `400` (`.strict()` rejects the unrecognised field — it does not silently ignore
            it, so a caller cannot believe it retargeted the event and be wrong).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ContactsError, RecordCommerceEventForContactResponse200]]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    body: Union[
        "CartAbandonedEventAdmin",
        "CartConvertedEventAdmin",
        "CartUpdatedEventAdmin",
        "OrderCancelledEventAdmin",
        "OrderCompletedEventAdmin",
        "OrderPlacedEventAdmin",
    ],
) -> Optional[Union[ContactsError, RecordCommerceEventForContactResponse200]]:
    r"""Record an order or cart correction for one contact (admin/CRM).

     The human counterpart to `recordCommerceEvent` — a tenant admin in
    the CRM correcting or backfilling what the machine feed missed or
    got wrong (a phone order, a manual backfill), through the
    identical event-shaped mechanism. Not a raw field-override: every
    write, machine or human, is an event the server derives aggregates
    from — there is no endpoint that sets e.g. `totalSpend` to an
    exact number directly.

    `:id` must already exist for the caller's own tenant — unlike the
    machine path, this path never creates a contact. A typo'd or
    cross-tenant `:id` is `404 CONTACT_NOT_FOUND`, never `403` — see
    `ContactsContactNotFound`.

    Same event taxonomy as `CommerceEvent`, minus `customerId` — see
    `CommerceEventAdmin`. Same `200`-always response shape, and the
    identical idempotency/rejection-recovery contract, as the machine
    path (see \"Idempotency, and rejection recovery\" above).

    Every event this path writes records the acting admin's identity
    for audit — \"who corrected this contact's order history\" is a
    support/compliance question a tenant will ask.

    Not exposed via `@dhaam-ccrm/node` — this is a CRM-console
    operation, not part of the merchant-facing SDK surface;
    `ChatServerClient` gains only the machine-path method.

    Args:
        id (str):
        body (Union['CartAbandonedEventAdmin', 'CartConvertedEventAdmin', 'CartUpdatedEventAdmin',
            'OrderCancelledEventAdmin', 'OrderCompletedEventAdmin', 'OrderPlacedEventAdmin']): The
            admin-path (staff-token) request shape for `POST /contacts/{id}/commerce-events` — field-
            for-field identical to `CommerceEvent` except `customerId` is absent from every variant.
            The target contact is named by `:id` in the path instead; supplying `customerId` in the
            body is a `400` (`.strict()` rejects the unrecognised field — it does not silently ignore
            it, so a caller cannot believe it retargeted the event and be wrong).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ContactsError, RecordCommerceEventForContactResponse200]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
