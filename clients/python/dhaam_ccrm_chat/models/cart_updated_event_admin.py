import datetime
from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.commerce_cart_item import CommerceCartItem


T = TypeVar("T", bound="CartUpdatedEventAdmin")


@_attrs_define
class CartUpdatedEventAdmin:
    """Admin-path variant of `CartUpdatedEvent` — see that schema for the full behavior, including the full-replace and
    stale-arrival rules. No `customerId`.

        Attributes:
            event_id (str):
            type_ (Literal['cart.updated']):
            occurred_at (datetime.datetime):
            cart_id (str):
            items (list['CommerceCartItem']):
    """

    event_id: str
    type_: Literal["cart.updated"]
    occurred_at: datetime.datetime
    cart_id: str
    items: list["CommerceCartItem"]

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        cart_id = self.cart_id

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "occurredAt": occurred_at,
                "cartId": cart_id,
                "items": items,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.commerce_cart_item import CommerceCartItem

        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = cast(Literal["cart.updated"], d.pop("type"))
        if type_ != "cart.updated":
            raise ValueError(f"type must match const 'cart.updated', got '{type_}'")

        occurred_at = isoparse(d.pop("occurredAt"))

        cart_id = d.pop("cartId")

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = CommerceCartItem.from_dict(items_item_data)

            items.append(items_item)

        cart_updated_event_admin = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            cart_id=cart_id,
            items=items,
        )

        return cart_updated_event_admin
