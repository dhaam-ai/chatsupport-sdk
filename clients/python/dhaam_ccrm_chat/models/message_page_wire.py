from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.chat_message_wire import ChatMessageWire


T = TypeVar("T", bound="MessagePageWire")


@_attrs_define
class MessagePageWire:
    """Actual wire shape of `GET /chat/sessions/{sessionId}/messages`'s `200` body (inside `data`) — replaces the idealized
    `MessagePage`, which this document previously documented and which is no longer referenced by any operation. See
    `ChatMessageWire`.

        Attributes:
            messages (list['ChatMessageWire']):
            has_more (bool):
    """

    messages: list["ChatMessageWire"]
    has_more: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        has_more = self.has_more

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "messages": messages,
                "hasMore": has_more,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.chat_message_wire import ChatMessageWire

        d = dict(src_dict)
        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = ChatMessageWire.from_dict(messages_item_data)

            messages.append(messages_item)

        has_more = d.pop("hasMore")

        message_page_wire = cls(
            messages=messages,
            has_more=has_more,
        )

        message_page_wire.additional_properties = d
        return message_page_wire

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
