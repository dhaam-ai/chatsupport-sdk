from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.chat_session_summary import ChatSessionSummary


T = TypeVar("T", bound="SessionSummaryPage")


@_attrs_define
class SessionSummaryPage:
    """
    Attributes:
        sessions (list['ChatSessionSummary']):
        has_more (bool):
    """

    sessions: list["ChatSessionSummary"]
    has_more: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sessions = []
        for sessions_item_data in self.sessions:
            sessions_item = sessions_item_data.to_dict()
            sessions.append(sessions_item)

        has_more = self.has_more

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessions": sessions,
                "hasMore": has_more,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.chat_session_summary import ChatSessionSummary

        d = dict(src_dict)
        sessions = []
        _sessions = d.pop("sessions")
        for sessions_item_data in _sessions:
            sessions_item = ChatSessionSummary.from_dict(sessions_item_data)

            sessions.append(sessions_item)

        has_more = d.pop("hasMore")

        session_summary_page = cls(
            sessions=sessions,
            has_more=has_more,
        )

        session_summary_page.additional_properties = d
        return session_summary_page

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
