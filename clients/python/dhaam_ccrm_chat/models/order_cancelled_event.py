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

T = TypeVar("T", bound="OrderCancelledEvent")


@_attrs_define
class OrderCancelledEvent:
    """An order was cancelled or failed. Increments `cancelledOrders` only. Deliberately does **not** touch
    `lastOrderMerchant`/ `lastOrderCategory`/`lastOrderAt` — a cancellation is real activity but not, in a support
    agent's reading of "last order," an order that actually happened; keeping it out of the latest-wins comparison means
    "last order" always names a placed-or-completed order, never a cancelled one that happens to be the most recent
    event.

        Attributes:
            event_id (str): Idempotency key — see "Idempotency, and rejection recovery" above.
            type_ (Literal['order.cancelled']): Wire STRING, not an integer enum — see `OrderPlacedEvent.type` for the full
                rationale.
            occurred_at (datetime.datetime): ISO-8601, UTC. Rejected with `400` if more than 5 minutes in the future; no
                lower bound.
            customer_id (str): The caller's own identifier for the shopper. See `OrderPlacedEvent.customerId`.
            order_id (str):
    """

    event_id: str
    type_: Literal["order.cancelled"]
    occurred_at: datetime.datetime
    customer_id: str
    order_id: str

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        customer_id = self.customer_id

        order_id = self.order_id

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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = cast(Literal["order.cancelled"], d.pop("type"))
        if type_ != "order.cancelled":
            raise ValueError(f"type must match const 'order.cancelled', got '{type_}'")

        occurred_at = isoparse(d.pop("occurredAt"))

        customer_id = d.pop("customerId")

        order_id = d.pop("orderId")

        order_cancelled_event = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            customer_id=customer_id,
            order_id=order_id,
        )

        return order_cancelled_event
