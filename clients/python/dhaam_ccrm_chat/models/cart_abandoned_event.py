import datetime
from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="CartAbandonedEvent")


@_attrs_define
class CartAbandonedEvent:
    """A specific cart is no longer being actively shopped — caller- declared (this event) or server-detected (an idle-cart
    sweep) both produce the identical state transition. The row must exist (`404 CART_NOT_FOUND` otherwise) and be
    `LIVE`; transitions to `ABANDONED`. Already `ABANDONED` is a no-op — `200`, `applied: true`, no state change.
    Already `CONVERTED` is `422 INVALID_CART_TRANSITION` — `CONVERTED` is terminal. See `ContactsCartNotFound` /
    `ContactsUnprocessableEntity` for the rejection responses and their (non-)effect on this event's `eventId`.

        Attributes:
            event_id (str): Idempotency key — see "Idempotency, and rejection recovery" above.
            type_ (Literal['cart.abandoned']): Wire STRING, not an integer enum — see `OrderPlacedEvent.type` for the full
                rationale.
            occurred_at (datetime.datetime): ISO-8601, UTC. Rejected with `400` if more than 5 minutes in the future; no
                lower bound.
            customer_id (str): The caller's own identifier for the shopper. See `OrderPlacedEvent.customerId`.
            cart_id (str):
    """

    event_id: str
    type_: Literal["cart.abandoned"]
    occurred_at: datetime.datetime
    customer_id: str
    cart_id: str

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        customer_id = self.customer_id

        cart_id = self.cart_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "occurredAt": occurred_at,
                "customerId": customer_id,
                "cartId": cart_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = cast(Literal["cart.abandoned"], d.pop("type"))
        if type_ != "cart.abandoned":
            raise ValueError(f"type must match const 'cart.abandoned', got '{type_}'")

        occurred_at = isoparse(d.pop("occurredAt"))

        customer_id = d.pop("customerId")

        cart_id = d.pop("cartId")

        cart_abandoned_event = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            customer_id=customer_id,
            cart_id=cart_id,
        )

        return cart_abandoned_event
