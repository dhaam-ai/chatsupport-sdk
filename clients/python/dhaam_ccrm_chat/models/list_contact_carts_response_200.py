from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.contact_cart_row import ContactCartRow


T = TypeVar("T", bound="ListContactCartsResponse200")


@_attrs_define
class ListContactCartsResponse200:
    """
    Attributes:
        success (bool):
        data (list['ContactCartRow']):
        total (int): Tenant-scoped count matching the same filters as `data` — never a cross-tenant total.
        page (int):
        page_size (int):
    """

    success: bool
    data: list["ContactCartRow"]
    total: int
    page: int
    page_size: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        total = self.total

        page = self.page

        page_size = self.page_size

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "success": success,
                "data": data,
                "total": total,
                "page": page,
                "pageSize": page_size,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.contact_cart_row import ContactCartRow

        d = dict(src_dict)
        success = d.pop("success")

        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = ContactCartRow.from_dict(data_item_data)

            data.append(data_item)

        total = d.pop("total")

        page = d.pop("page")

        page_size = d.pop("pageSize")

        list_contact_carts_response_200 = cls(
            success=success,
            data=data,
            total=total,
            page=page,
            page_size=page_size,
        )

        list_contact_carts_response_200.additional_properties = d
        return list_contact_carts_response_200

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
