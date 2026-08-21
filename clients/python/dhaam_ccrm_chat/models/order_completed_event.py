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

T = TypeVar("T", bound="OrderCompletedEvent")


@_attrs_define
class OrderCompletedEvent:
    """An order finished successfully (paid, fulfilled — the merchant's own definition of "done"). Increments
    `completedOrders`; adds `value` to `totalSpend`; recomputes `averageOrderValue = totalSpend / completedOrders` in
    the same transaction (`0` when `completedOrders` is `0` — never a division-by-zero error). Updates
    `lastOrderMerchant`/`lastOrderCategory`/`lastOrderAt` under the identical latest-wins rule `order.placed` uses — a
    completed order is evidence of "last order" activity too.

        Attributes:
            event_id (str): Idempotency key — see "Idempotency, and rejection recovery" above.
            type_ (Literal['order.completed']): Wire STRING, not an integer enum — see `OrderPlacedEvent.type` for the full
                rationale (this is an open event tag, not closed-cardinality state).
            occurred_at (datetime.datetime): ISO-8601, UTC. Rejected with `400` if more than 5 minutes in the future; no
                lower bound. See `OrderPlacedEvent.occurredAt`.
            customer_id (str): The caller's own identifier for the shopper. See `OrderPlacedEvent.customerId`.
            order_id (str):
            value (float): Applied to `totalSpend` and folded into `averageOrderValue` — the only event type whose `value`
                moves an aggregate.
            merchant (Union[Unset, str]):
            category (Union[Unset, str]):
    """

    event_id: str
    type_: Literal["order.completed"]
    occurred_at: datetime.datetime
    customer_id: str
    order_id: str
    value: float
    merchant: Union[Unset, str] = UNSET
    category: Union[Unset, str] = UNSET

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        customer_id = self.customer_id

        order_id = self.order_id

        value = self.value

        merchant = self.merchant

        category = self.category

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "occurredAt": occurred_at,
                "customerId": customer_id,
                "orderId": order_id,
                "value": value,
            }
        )
        if merchant is not UNSET:
            field_dict["merchant"] = merchant
        if category is not UNSET:
            field_dict["category"] = category

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = cast(Literal["order.completed"], d.pop("type"))
        if type_ != "order.completed":
            raise ValueError(f"type must match const 'order.completed', got '{type_}'")

        occurred_at = isoparse(d.pop("occurredAt"))

        customer_id = d.pop("customerId")

        order_id = d.pop("orderId")

        value = d.pop("value")

        merchant = d.pop("merchant", UNSET)

        category = d.pop("category", UNSET)

        order_completed_event = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            customer_id=customer_id,
            order_id=order_id,
            value=value,
            merchant=merchant,
            category=category,
        )

        return order_completed_event
