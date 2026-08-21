import datetime
from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.message_type import MessageType
from ..models.sender_type import SenderType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.attachment import Attachment
    from ..models.chat_message_metadata import ChatMessageMetadata
    from ..models.message_reply_preview import MessageReplyPreview


T = TypeVar("T", bound="ChatMessage")


@_attrs_define
class ChatMessage:
    """The **normalized** message shape `@dhaam-ccrm/core` consumes. **`GET /chat/sessions/{sessionId}/messages` and `GET
    /chat/sessions/{sessionId}/full` do NOT return this shape on the wire** — see `ChatMessageWire` for what they
    actually send and how `@dhaam-ccrm/rest` converts it to this shape.

        Attributes:
            id (str): Opaque message identifier. Under D1, this is the client-generated ULID for customer-sent messages — it
                never changes after creation; there is no separate server-assigned id to swap in later.
            chat_session_id (str):
            sender_type (SenderType):
            content (str):
            message_type (MessageType):
            created_at (datetime.datetime): The one canonical timestamp field for this concept (D4) — v1 aliased this across
                four different field names (`timestamp`/`createdAt`/`created_at`/`sentAt`) depending on endpoint and rollout
                era.
            sender_id (Union[None, Unset, str]):
            sender_name (Union[None, Unset, str]):
            attachment (Union['Attachment', None, Unset]): The **one** canonical location for attachment data (D4) — v1 read
                this from either `message.attachment` or `message.metadata.attachment` interchangeably.
            reply_to_message_id (Union[None, Unset, str]):
            reply_to_message (Union['MessageReplyPreview', None, Unset]):
            metadata (Union[Unset, ChatMessageMetadata]): Free-form additional context. Never used for attachment data — see
                `attachment`.
    """

    id: str
    chat_session_id: str
    sender_type: SenderType
    content: str
    message_type: MessageType
    created_at: datetime.datetime
    sender_id: Union[None, Unset, str] = UNSET
    sender_name: Union[None, Unset, str] = UNSET
    attachment: Union["Attachment", None, Unset] = UNSET
    reply_to_message_id: Union[None, Unset, str] = UNSET
    reply_to_message: Union["MessageReplyPreview", None, Unset] = UNSET
    metadata: Union[Unset, "ChatMessageMetadata"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.attachment import Attachment
        from ..models.message_reply_preview import MessageReplyPreview

        id = self.id

        chat_session_id = self.chat_session_id

        sender_type = self.sender_type.value

        content = self.content

        message_type = self.message_type.value

        created_at = self.created_at.isoformat()

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

        attachment: Union[None, Unset, dict[str, Any]]
        if isinstance(self.attachment, Unset):
            attachment = UNSET
        elif isinstance(self.attachment, Attachment):
            attachment = self.attachment.to_dict()
        else:
            attachment = self.attachment

        reply_to_message_id: Union[None, Unset, str]
        if isinstance(self.reply_to_message_id, Unset):
            reply_to_message_id = UNSET
        else:
            reply_to_message_id = self.reply_to_message_id

        reply_to_message: Union[None, Unset, dict[str, Any]]
        if isinstance(self.reply_to_message, Unset):
            reply_to_message = UNSET
        elif isinstance(self.reply_to_message, MessageReplyPreview):
            reply_to_message = self.reply_to_message.to_dict()
        else:
            reply_to_message = self.reply_to_message

        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "chatSessionId": chat_session_id,
                "senderType": sender_type,
                "content": content,
                "messageType": message_type,
                "createdAt": created_at,
            }
        )
        if sender_id is not UNSET:
            field_dict["senderId"] = sender_id
        if sender_name is not UNSET:
            field_dict["senderName"] = sender_name
        if attachment is not UNSET:
            field_dict["attachment"] = attachment
        if reply_to_message_id is not UNSET:
            field_dict["replyToMessageId"] = reply_to_message_id
        if reply_to_message is not UNSET:
            field_dict["replyToMessage"] = reply_to_message
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.attachment import Attachment
        from ..models.chat_message_metadata import ChatMessageMetadata
        from ..models.message_reply_preview import MessageReplyPreview

        d = dict(src_dict)
        id = d.pop("id")

        chat_session_id = d.pop("chatSessionId")

        sender_type = SenderType(d.pop("senderType"))

        content = d.pop("content")

        message_type = MessageType(d.pop("messageType"))

        created_at = isoparse(d.pop("createdAt"))

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

        def _parse_attachment(data: object) -> Union["Attachment", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                attachment_type_0 = Attachment.from_dict(data)

                return attachment_type_0
            except:  # noqa: E722
                pass
            return cast(Union["Attachment", None, Unset], data)

        attachment = _parse_attachment(d.pop("attachment", UNSET))

        def _parse_reply_to_message_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        reply_to_message_id = _parse_reply_to_message_id(
            d.pop("replyToMessageId", UNSET)
        )

        def _parse_reply_to_message(
            data: object,
        ) -> Union["MessageReplyPreview", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                reply_to_message_type_0 = MessageReplyPreview.from_dict(data)

                return reply_to_message_type_0
            except:  # noqa: E722
                pass
            return cast(Union["MessageReplyPreview", None, Unset], data)

        reply_to_message = _parse_reply_to_message(d.pop("replyToMessage", UNSET))

        _metadata = d.pop("metadata", UNSET)
        metadata: Union[Unset, ChatMessageMetadata]
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = ChatMessageMetadata.from_dict(_metadata)

        chat_message = cls(
            id=id,
            chat_session_id=chat_session_id,
            sender_type=sender_type,
            content=content,
            message_type=message_type,
            created_at=created_at,
            sender_id=sender_id,
            sender_name=sender_name,
            attachment=attachment,
            reply_to_message_id=reply_to_message_id,
            reply_to_message=reply_to_message,
            metadata=metadata,
        )

        chat_message.additional_properties = d
        return chat_message

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
