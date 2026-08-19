from collections.abc import Mapping
from typing import (
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.message_type import MessageType
from ..models.sender_type import SenderType
from ..types import UNSET, Unset

T = TypeVar("T", bound="MessageReplyPreview")


@_attrs_define
class MessageReplyPreview:
    """Denormalized preview of the message being replied to.

    Attributes:
        id (str):
        content (str):
        sender_type (SenderType):
        sender_id (Union[None, Unset, str]):
        sender_name (Union[None, Unset, str]):
        message_type (Union[Unset, MessageType]):
    """

    id: str
    content: str
    sender_type: SenderType
    sender_id: Union[None, Unset, str] = UNSET
    sender_name: Union[None, Unset, str] = UNSET
    message_type: Union[Unset, MessageType] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        content = self.content

        sender_type = self.sender_type.value

        sender_id: Union[None, Unset, str]
        if isinstance(self.sender_id, Unset):
            sender_id = UNSET
        else:
            sender_id = self.sender_id

        sender_name: Union[None, Unset, str]
        if isinstance(self.sender_name, Unset):
            sender_name = UNSET
        else:
            sender_name = self.sender_name

        message_type: Union[Unset, str] = UNSET
        if not isinstance(self.message_type, Unset):
            message_type = self.message_type.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "content": content,
                "senderType": sender_type,
            }
        )
        if sender_id is not UNSET:
            field_dict["senderId"] = sender_id
        if sender_name is not UNSET:
            field_dict["senderName"] = sender_name
        if message_type is not UNSET:
            field_dict["messageType"] = message_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        content = d.pop("content")

        sender_type = SenderType(d.pop("senderType"))

        def _parse_sender_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        sender_id = _parse_sender_id(d.pop("senderId", UNSET))

        def _parse_sender_name(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        sender_name = _parse_sender_name(d.pop("senderName", UNSET))

        _message_type = d.pop("messageType", UNSET)
        message_type: Union[Unset, MessageType]
        if isinstance(_message_type, Unset):
            message_type = UNSET
        else:
            message_type = MessageType(_message_type)

        message_reply_preview = cls(
            id=id,
            content=content,
            sender_type=sender_type,
            sender_id=sender_id,
            sender_name=sender_name,
            message_type=message_type,
        )

        message_reply_preview.additional_properties = d
        return message_reply_preview

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
