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


T = TypeVar("T", bound="CartUpdatedEvent")


@_attrs_define
class CartUpdatedEvent:
    """The current, LIVE state of one cart — a **full replace** of that cart's contents, not a delta. `items` may be empty:
    an emptied-but-still-open cart is a valid `LIVE` state with 0 items, distinct from `ABANDONED`. A stale arrival —
    `occurredAt` older than the cart row's current snapshot — is silently ignored: `applied: true`, no state change, NOT
    treated as a caller error (distinct from the idempotency `applied: false` case, which is about the *event* having
    been seen before rather than the *state* being stale). `Contact.itemsInCart`/`cartValue` are recomputed from
    whichever `LIVE` cart is now this contact's most-recently-touched one — which may or may not be the cart this event
    just touched; see `ContactCartRow`'s description for the full mirror rule.

        Attributes:
            event_id (str): Idempotency key — see "Idempotency, and rejection recovery" above.
            type_ (Literal['cart.updated']): Wire STRING, not an integer enum — see `OrderPlacedEvent.type` for the full
                rationale.
            occurred_at (datetime.datetime): ISO-8601, UTC. Rejected with `400` if more than 5 minutes in the future; no
                lower bound.
            customer_id (str): The caller's own identifier for the shopper. See `OrderPlacedEvent.customerId`.
            cart_id (str): The merchant's own cart identifier. Unique per CONTACT, not globally.
            items (list['CommerceCartItem']): Full replacement of the cart's line items. A 501st entry is refused outright
                with `400` — reject, not clamp — never silently truncated to 500.
    """

    event_id: str
    type_: Literal["cart.updated"]
    occurred_at: datetime.datetime
    customer_id: str
    cart_id: str
    items: list["CommerceCartItem"]

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        customer_id = self.customer_id

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
                "customerId": customer_id,
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

        customer_id = d.pop("customerId")

        cart_id = d.pop("cartId")

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = CommerceCartItem.from_dict(items_item_data)

            items.append(items_item)

        cart_updated_event = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            customer_id=customer_id,
            cart_id=cart_id,
            items=items,
        )

        return cart_updated_event
