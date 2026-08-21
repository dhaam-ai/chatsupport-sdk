from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.session_full_wire import SessionFullWire


T = TypeVar("T", bound="GetSessionFullResponse200")


@_attrs_define
class GetSessionFullResponse200:
    """
    Attributes:
        success (bool):
        data (SessionFullWire): Actual wire shape of `GET /chat/sessions/{sessionId}/full`'s `200` body (inside `data`)
            — replaces the idealized `SessionFull`, which this document previously documented and which is no longer
            referenced by any operation. Only `messages` differs structurally from what `SessionFull` modeled — see
            `ChatMessageWire`. `session`'s own `status`/`mode` are also raw integers on this path (reuse `ChatSession`'s
            `status`/`mode` field names but expect the same integer codes documented on `ChatMessageWire.senderType`'s
            sibling table, i.e. `ChatStatus`/`ChatMode`'s backend ints), and its `assignedAgent`/`customer` are missing
            `participantId` — a smaller, separately-tracked accuracy gap not fully re-modeled in this revision.
    """

    success: bool
    data: "SessionFullWire"
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
        from ..models.session_full_wire import SessionFullWire

        d = dict(src_dict)
        success = d.pop("success")

        data = SessionFullWire.from_dict(d.pop("data"))

        get_session_full_response_200 = cls(
            success=success,
            data=data,
        )

        get_session_full_response_200.additional_properties = d
        return get_session_full_response_200

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
