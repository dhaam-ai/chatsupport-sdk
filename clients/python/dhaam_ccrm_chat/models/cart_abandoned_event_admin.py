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

T = TypeVar("T", bound="CartAbandonedEventAdmin")


@_attrs_define
class CartAbandonedEventAdmin:
    """Admin-path variant of `CartAbandonedEvent` — see that schema for the full behavior, including the
    terminal-`CONVERTED` rejection. No `customerId`.

        Attributes:
            event_id (str):
            type_ (Literal['cart.abandoned']):
            occurred_at (datetime.datetime):
            cart_id (str):
    """

    event_id: str
    type_: Literal["cart.abandoned"]
    occurred_at: datetime.datetime
    cart_id: str

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        cart_id = self.cart_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "occurredAt": occurred_at,
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

        cart_id = d.pop("cartId")

        cart_abandoned_event_admin = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            cart_id=cart_id,
        )

        return cart_abandoned_event_admin
