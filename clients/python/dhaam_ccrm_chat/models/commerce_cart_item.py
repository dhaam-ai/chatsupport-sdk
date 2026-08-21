from collections.abc import Mapping
from typing import (
    Any,
    TypeVar,
    Union,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CommerceCartItem")


@_attrs_define
class CommerceCartItem:
    """One line item inside a `cart.updated` snapshot.

    Attributes:
        name (str):
        quantity (int):
        unit_price (float):
        sku (Union[Unset, str]):
    """

    name: str
    quantity: int
    unit_price: float
    sku: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        quantity = self.quantity

        unit_price = self.unit_price

        sku = self.sku

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "quantity": quantity,
                "unitPrice": unit_price,
            }
        )
        if sku is not UNSET:
            field_dict["sku"] = sku

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        quantity = d.pop("quantity")

        unit_price = d.pop("unitPrice")

        sku = d.pop("sku", UNSET)

        commerce_cart_item = cls(
            name=name,
            quantity=quantity,
            unit_price=unit_price,
            sku=sku,
        )

        commerce_cart_item.additional_properties = d
        return commerce_cart_item

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
