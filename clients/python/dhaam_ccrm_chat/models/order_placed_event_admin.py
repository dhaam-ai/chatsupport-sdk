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

T = TypeVar("T", bound="OrderPlacedEventAdmin")


@_attrs_define
class OrderPlacedEventAdmin:
    """Admin-path variant of `OrderPlacedEvent` — see that schema for the full behavior. No `customerId`; the target
    contact is named by `:id` in the path, and supplying `customerId` here is a `400` (`.strict()` rejects the
    unrecognised field).

        Attributes:
            event_id (str):
            type_ (Literal['order.placed']):
            occurred_at (datetime.datetime):
            order_id (str):
            merchant (Union[Unset, str]):
            category (Union[Unset, str]):
            cart_id (Union[Unset, str]):
            value (Union[Unset, float]):
    """

    event_id: str
    type_: Literal["order.placed"]
    occurred_at: datetime.datetime
    order_id: str
    merchant: Union[Unset, str] = UNSET
    category: Union[Unset, str] = UNSET
    cart_id: Union[Unset, str] = UNSET
    value: Union[Unset, float] = UNSET

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

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

        order_id = d.pop("orderId")

        merchant = d.pop("merchant", UNSET)

        category = d.pop("category", UNSET)

        cart_id = d.pop("cartId", UNSET)

        value = d.pop("value", UNSET)

        order_placed_event_admin = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            order_id=order_id,
            merchant=merchant,
            category=category,
            cart_id=cart_id,
            value=value,
        )

        return order_placed_event_admin
