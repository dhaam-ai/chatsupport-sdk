from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.chat_message import ChatMessage
    from ..models.chat_session import ChatSession
    from ..models.participant import Participant


T = TypeVar("T", bound="SessionFull")


@_attrs_define
class SessionFull:
    """
    Attributes:
        session (ChatSession):
        participants (list['Participant']):
        messages (list['ChatMessage']): Most recent page, ascending chronological order (oldest first).
        has_more (bool): Whether older messages exist beyond this page. Page further back with `GET
            /sessions/{sessionId}/messages`.
    """

    session: "ChatSession"
    participants: list["Participant"]
    messages: list["ChatMessage"]
    has_more: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session = self.session.to_dict()

        participants = []
        for participants_item_data in self.participants:
            participants_item = participants_item_data.to_dict()
            participants.append(participants_item)

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        has_more = self.has_more

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "session": session,
                "participants": participants,
                "messages": messages,
                "hasMore": has_more,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.chat_message import ChatMessage
        from ..models.chat_session import ChatSession
        from ..models.participant import Participant

        d = dict(src_dict)
        session = ChatSession.from_dict(d.pop("session"))

        participants = []
        _participants = d.pop("participants")
        for participants_item_data in _participants:
            participants_item = Participant.from_dict(participants_item_data)

            participants.append(participants_item)

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = ChatMessage.from_dict(messages_item_data)

            messages.append(messages_item)

        has_more = d.pop("hasMore")

        session_full = cls(
            session=session,
            participants=participants,
            messages=messages,
            has_more=has_more,
        )

        session_full.additional_properties = d
        return session_full

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
