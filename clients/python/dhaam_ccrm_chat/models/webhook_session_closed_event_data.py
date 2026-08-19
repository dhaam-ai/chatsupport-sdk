from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.close_reason import CloseReason

if TYPE_CHECKING:
    from ..models.chat_session import ChatSession


T = TypeVar("T", bound="WebhookSessionClosedEventData")


@_attrs_define
class WebhookSessionClosedEventData:
    """
    Attributes:
        session (ChatSession):
        close_reason (CloseReason): First-class enum for why a session entered CLOSED (PRD §12.5) — v1 only had this as
            a loose `string | null` code comment (`'SWITCHED' | 'MANUAL' | null`).
    """

    session: "ChatSession"
    close_reason: CloseReason
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session = self.session.to_dict()

        close_reason = self.close_reason.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "session": session,
                "closeReason": close_reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.chat_session import ChatSession

        d = dict(src_dict)
        session = ChatSession.from_dict(d.pop("session"))

        close_reason = CloseReason(d.pop("closeReason"))

        webhook_session_closed_event_data = cls(
            session=session,
            close_reason=close_reason,
        )

        webhook_session_closed_event_data.additional_properties = d
        return webhook_session_closed_event_data

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
