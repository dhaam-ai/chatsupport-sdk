import datetime
from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="OrderPlacedEvent")


@_attrs_define
class OrderPlacedEvent:
    """An order was submitted; fulfillment/payment outcome not yet known. Increments `totalOrders`. Updates
    `lastOrderMerchant`/ `lastOrderCategory`/`lastOrderAt` only if `occurredAt` is strictly newer than the contact's
    stored `lastOrderAt` AND the corresponding field was supplied. `value`, if supplied, is recorded for audit only —
    never applied to `totalSpend` (only `order.completed`'s own `value` does that). If `cartId` matches a `LIVE` cart,
    that cart is transitioned to `CONVERTED` as a side effect — the identical transition an explicit `cart.converted`
    for the same `cartId` would produce. A `cartId` with no matching row is a silent no-op, not a `404` — only a
    `cart.*` event 404s on an unknown `cartId`.

        Attributes:
            event_id (str): Idempotency key — see "Idempotency, and rejection recovery" above.
            type_ (Literal['order.placed']): An open, additive tag for "a kind of thing that happened," not a closed-
                cardinality state field — deliberately a wire STRING rather than an integer enum, mirroring `@dhaam-ccrm/node`'s
                own webhook `type` field (see `WebhookMessageCreatedEvent.type` etc. above) rather than this codebase's usual
                "enums are integers on the wire" rule. That rule governs closed- cardinality *state* (e.g.
                `ContactCartRow.status` below); `type` here is the same kind of open catalog `message.created`/`session.updated`
                already are — new event types are additive, and nothing downstream switches on it as a fixed-size set.
            occurred_at (datetime.datetime): When this actually happened, not when the caller calls this endpoint. ISO-8601,
                UTC. Rejected with `400` if more than 5 minutes in the future (clock-skew tolerance). No lower bound — a
                backdated admin correction is legitimate.
            customer_id (str): The caller's own identifier for the shopper — the same value passed as `userId` to `POST
                /tokens`. The server resolves-or- creates a `Contact` for `(tenantId, externalId = customerId)`. This is the
                ONLY field that may bind an event to a contact; nothing else in this body is ever used for identity matching.
            order_id (str):
            merchant (Union[Unset, str]):
            category (Union[Unset, str]):
            cart_id (Union[Unset, str]): If this order completed a cart checkout, the cart's id — triggers the
                `cart.converted` side effect described above.
            value (Union[Unset, float]): Audit-only on this event type. Never applied to `totalSpend` — see the schema
                description.
    """

    event_id: str
    type_: Literal["order.placed"]
    occurred_at: datetime.datetime
    customer_id: str
    order_id: str
    merchant: Union[Unset, str] = UNSET
    category: Union[Unset, str] = UNSET
    cart_id: Union[Unset, str] = UNSET
    value: Union[Unset, float] = UNSET

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        customer_id = self.customer_id

        order_id = self.order_id

        merchant = self.merchant

        category = self.category

        cart_id = self.cart_id

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "occurredAt": occurred_at,
                "customerId": customer_id,
                "orderId": order_id,
            }
        )
        if merchant is not UNSET:
            field_dict["merchant"] = merchant
        if category is not UNSET:
            field_dict["category"] = category
        if cart_id is not UNSET:
            field_dict["cartId"] = cart_id
        if value is not UNSET:
            field_dict["value"] = value

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = cast(Literal["order.placed"], d.pop("type"))
        if type_ != "order.placed":
            raise ValueError(f"type must match const 'order.placed', got '{type_}'")

        occurred_at = isoparse(d.pop("occurredAt"))

        customer_id = d.pop("customerId")

        order_id = d.pop("orderId")

        merchant = d.pop("merchant", UNSET)

        category = d.pop("category", UNSET)

        cart_id = d.pop("cartId", UNSET)

        value = d.pop("value", UNSET)

        order_placed_event = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            customer_id=customer_id,
            order_id=order_id,
            merchant=merchant,
            category=category,
            cart_id=cart_id,
            value=value,
        )

        return order_placed_event
