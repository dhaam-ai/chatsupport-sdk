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

T = TypeVar("T", bound="OrderCancelledEventAdmin")


@_attrs_define
class OrderCancelledEventAdmin:
    """Admin-path variant of `OrderCancelledEvent` — see that schema for the full behavior. No `customerId`.

    Attributes:
        event_id (str):
        type_ (Literal['order.cancelled']):
        occurred_at (datetime.datetime):
        order_id (str):
    """

    event_id: str
    type_: Literal["order.cancelled"]
    occurred_at: datetime.datetime
    order_id: str

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        order_id = self.order_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "occurredAt": occurred_at,
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

        order_id = d.pop("orderId")

        order_cancelled_event_admin = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            order_id=order_id,
        )

        return order_cancelled_event_admin
