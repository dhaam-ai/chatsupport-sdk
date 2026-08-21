from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.commerce_event_result import CommerceEventResult


T = TypeVar("T", bound="RecordCommerceEventResponse200")


@_attrs_define
class RecordCommerceEventResponse200:
    """
    Attributes:
        success (bool):
        data (CommerceEventResult): Response `data` for both write operations, first application or replay alike.
    """

    success: bool
    data: "CommerceEventResult"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "success": success,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.commerce_event_result import CommerceEventResult

        d = dict(src_dict)
        success = d.pop("success")

        data = CommerceEventResult.from_dict(d.pop("data"))

        record_commerce_event_response_200 = cls(
            success=success,
            data=data,
        )

        record_commerce_event_response_200.additional_properties = d
        return record_commerce_event_response_200

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
