from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.session_summary_page_wire import SessionSummaryPageWire


T = TypeVar("T", bound="ListSessionsResponse200")


@_attrs_define
class ListSessionsResponse200:
    """
    Attributes:
        success (bool):
        data (SessionSummaryPageWire): Actual wire shape of `GET /chat/sessions/customer`'s `200` body (inside `data`) —
            replaces the idealized `SessionSummaryPage`. **No `hasMore` field at all** — `chat.routes.ts:238` replies `{
            success: true, data: { sessions } }` and nothing else.
    """

    success: bool
    data: "SessionSummaryPageWire"
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
        from ..models.session_summary_page_wire import SessionSummaryPageWire

        d = dict(src_dict)
        success = d.pop("success")

        data = SessionSummaryPageWire.from_dict(d.pop("data"))

        list_sessions_response_200 = cls(
            success=success,
            data=data,
        )

        list_sessions_response_200.additional_properties = d
        return list_sessions_response_200

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
