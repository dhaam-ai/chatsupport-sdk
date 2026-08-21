import datetime
from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.contact_cart_row_status import ContactCartRowStatus

if TYPE_CHECKING:
    from ..models.commerce_cart_item import CommerceCartItem


T = TypeVar("T", bound="ContactCartRow")


@_attrs_define
class ContactCartRow:
    """One row from `contact_carts`, as returned by both cart-read operations. `status` is a raw integer code — this
    feature follows the same wire convention every other Contacts CRM enum already uses (`GET /contacts`'s
    `status`/`userType`/`channel` fields), not the lowercase string the `status` QUERY parameter on `GET
    /contacts/carts` accepts. The two are intentionally different shapes for the same concept: the query parameter is a
    human-typed filter value, the response field is the established typed-enum wire contract.
    `Contact.itemsInCart`/`cartValue` mirror only the contact's single most-recently-touched `LIVE` row (by
    `lastEventAt`) — a contact can have more than one `LIVE` row here at once (two browser tabs, a guest cart merged
    into a signed-in one), and this operation is the only way to see the rest.

        Attributes:
            contact_id (str): Opaque contact id — same value as `GET /contacts/:id`'s `id`.
            contact_ref (str): The contact's customer-facing reference — what an agent building a win-back campaign wants to
                see, not the opaque id.
            cart_id (str): The merchant's own cart identifier, as supplied on `cart.*` events. Unique per contact, not
                globally.
            status (ContactCartRowStatus): `ContactCartStatus`: 1=LIVE, 2=ABANDONED, 3=CONVERTED
                (`shared/constants/enums.ts`).
            items_count (int): Sum of `quantity` across the cart's line items as of the most recently applied
                `cart.updated`.
            cart_value (float): Sum of `unitPrice × quantity` across the cart's line items.
            items (list['CommerceCartItem']): Line-item snapshot as of the most recently applied `cart.updated`.
            abandoned_at (Union[None, datetime.datetime]):
            converted_at (Union[None, datetime.datetime]):
            updated_at (datetime.datetime):
    """

    contact_id: str
    contact_ref: str
    cart_id: str
    status: ContactCartRowStatus
    items_count: int
    cart_value: float
    items: list["CommerceCartItem"]
    abandoned_at: Union[None, datetime.datetime]
    converted_at: Union[None, datetime.datetime]
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        contact_id = self.contact_id

        contact_ref = self.contact_ref

        cart_id = self.cart_id

        status = self.status.value

        items_count = self.items_count

        cart_value = self.cart_value

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        abandoned_at: Union[None, str]
        if isinstance(self.abandoned_at, datetime.datetime):
            abandoned_at = self.abandoned_at.isoformat()
        else:
            abandoned_at = self.abandoned_at

        converted_at: Union[None, str]
        if isinstance(self.converted_at, datetime.datetime):
            converted_at = self.converted_at.isoformat()
        else:
            converted_at = self.converted_at

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "contactId": contact_id,
                "contactRef": contact_ref,
                "cartId": cart_id,
                "status": status,
                "itemsCount": items_count,
                "cartValue": cart_value,
                "items": items,
                "abandonedAt": abandoned_at,
                "convertedAt": converted_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.commerce_cart_item import CommerceCartItem

        d = dict(src_dict)
        contact_id = d.pop("contactId")

        contact_ref = d.pop("contactRef")

        cart_id = d.pop("cartId")

        status = ContactCartRowStatus(d.pop("status"))

        items_count = d.pop("itemsCount")

        cart_value = d.pop("cartValue")

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = CommerceCartItem.from_dict(items_item_data)

            items.append(items_item)

        def _parse_abandoned_at(data: object) -> Union[None, datetime.datetime]:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                abandoned_at_type_0 = isoparse(data)

                return abandoned_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, datetime.datetime], data)

        abandoned_at = _parse_abandoned_at(d.pop("abandonedAt"))

        def _parse_converted_at(data: object) -> Union[None, datetime.datetime]:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                converted_at_type_0 = isoparse(data)

                return converted_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, datetime.datetime], data)

        converted_at = _parse_converted_at(d.pop("convertedAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        contact_cart_row = cls(
            contact_id=contact_id,
            contact_ref=contact_ref,
            cart_id=cart_id,
            status=status,
            items_count=items_count,
            cart_value=cart_value,
            items=items,
            abandoned_at=abandoned_at,
            converted_at=converted_at,
            updated_at=updated_at,
        )

        contact_cart_row.additional_properties = d
        return contact_cart_row

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
