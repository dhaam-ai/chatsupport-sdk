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

T = TypeVar("T", bound="CartConvertedEvent")


@_attrs_define
class CartConvertedEvent:
    """A specific cart resulted in a checkout. Also triggered as a side effect of `order.placed` carrying the same `cartId`
    — they describe the same real-world action two ways; use whichever your checkout flow naturally emits. The row must
    exist and be `LIVE` or `ABANDONED` (a customer may return to an abandoned cart and check out); transitions to
    `CONVERTED`. Already `CONVERTED` is a no-op — `200`, `applied: true`, no state change. `404 CART_NOT_FOUND` if the
    row never existed. `orderId`, if supplied, is stored for correlation only — never applied to any aggregate
    (`order.completed`'s own `value` is what moves `totalSpend`).

        Attributes:
            event_id (str): Idempotency key — see "Idempotency, and rejection recovery" above.
            type_ (Literal['cart.converted']): Wire STRING, not an integer enum — see `OrderPlacedEvent.type` for the full
                rationale.
            occurred_at (datetime.datetime): ISO-8601, UTC. Rejected with `400` if more than 5 minutes in the future; no
                lower bound.
            customer_id (str): The caller's own identifier for the shopper. See `OrderPlacedEvent.customerId`.
            cart_id (str):
            order_id (Union[Unset, str]): Correlation only — stored on the cart row, never applied to any aggregate.
    """

    event_id: str
    type_: Literal["cart.converted"]
    occurred_at: datetime.datetime
    customer_id: str
    cart_id: str
    order_id: Union[Unset, str] = UNSET

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_

        occurred_at = self.occurred_at.isoformat()

        customer_id = self.customer_id

        cart_id = self.cart_id

        order_id = self.order_id

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

        customer_id = d.pop("customerId")

        cart_id = d.pop("cartId")

        order_id = d.pop("orderId", UNSET)

        cart_converted_event = cls(
            event_id=event_id,
            type_=type_,
            occurred_at=occurred_at,
            customer_id=customer_id,
            cart_id=cart_id,
            order_id=order_id,
        )

        return cart_converted_event
