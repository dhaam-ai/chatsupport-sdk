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

T = TypeVar("T", bound="CartConvertedEventAdmin")


@_attrs_define
class CartConvertedEventAdmin:
    """Admin-path variant of `CartConvertedEvent` — see that schema for the full behavior. No `customerId`.

    Attributes:
        event_id (str):
        type_ (Literal['cart.converted']):
        occurred_at (datetime.datetime):
        cart_id (str):
        order_id (Union[Unset, str]):
    """

    event_id: str
    type_: Literal["cart.converted"]
    occurred_at: datetime.datetime
    cart_id: str
    order_id: Union[Unset, str] = UNSET

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        cart_id = self.cart_id

        order_id = self.order_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "occurredAt": occurred_at,
                "cartId": cart_id,
            }
        )
        if order_id is not UNSET:
            field_dict["orderId"] = order_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = cast(Literal["cart.converted"], d.pop("type"))
        if type_ != "cart.converted":
            raise ValueError(f"type must match const 'cart.converted', got '{type_}'")

        occurred_at = isoparse(d.pop("occurredAt"))

        cart_id = d.pop("cartId")

        order_id = d.pop("orderId", UNSET)

        cart_converted_event_admin = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            cart_id=cart_id,
            order_id=order_id,
        )

        return cart_converted_event_admin
