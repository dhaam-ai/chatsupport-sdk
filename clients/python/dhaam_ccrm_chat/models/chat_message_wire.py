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

from ..models.chat_message_wire_message_type import ChatMessageWireMessageType
from ..models.chat_message_wire_sender_type import ChatMessageWireSenderType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.chat_message_wire_metadata import ChatMessageWireMetadata
    from ..models.message_reply_preview import MessageReplyPreview


T = TypeVar("T", bound="ChatMessageWire")


@_attrs_define
class ChatMessageWire:
    """**Actual wire shape returned by `GET /chat/sessions/{sessionId}/messages` and `GET
    /chat/sessions/{sessionId}/full`** — NOT the normalized `ChatMessage` shape above. The REST history handlers
    (`message.service.ts` `getMessages`/`getMessagesPaginated`, `getSessionWithMessages`) return the Prisma row for
    `ChatMessage` directly, with none of the wire projection the WebSocket path applies
    (`api/websocket/v2/projection.ts` `projectMessage`). Two concrete deviations from `ChatMessage`:
    1. `senderType` and `messageType` are the backend's internal
       **integer** codes, not string enum names. See `senderType`/
       `messageType` below for the exact mapping.
    2. `attachment` data is **not lifted to top level**. When a message
       carries an attachment it is nested at `metadata.attachment`
       (with the same shape as `Attachment` below); `attachment` itself
       is absent from the row entirely.

    `@dhaam-ccrm/rest`'s `createHistorySource` adapter converts every row of this shape into `ChatMessage` before
    handing it to `@dhaam-ccrm/core` (int→string enum lookup, and lifting/stripping `metadata.attachment` — implemented
    in `packages/rest/src/projection.ts`). This is where the "message history not appearing after reload" defect
    actually lived, and this schema exists so that normalization step is never silently reverted.

        Attributes:
            id (str):
            chat_session_id (str):
            sender_type (ChatMessageWireSenderType): 1=CUSTOMER, 2=AGENT, 3=BOT, 4=SYSTEM
                (`shared/constants/enums.ts:29-34`).
            content (str):
            message_type (ChatMessageWireMessageType): 1=TEXT, 2=SYSTEM, 3=FILE, 4=IMAGE, 5=VIDEO, 6=AUDIO, 7=TYPING
                (`shared/constants/enums.ts:36-44`).
            created_at (datetime.datetime):
            sender_id (Union[None, Unset, str]):
            metadata (Union[Unset, ChatMessageWireMetadata]): Free-form context AND, when present, an `attachment` key
                holding the same shape as `Attachment` — this is the legacy column v1 used for both purposes; nothing on this
                REST path splits them.
            reply_to_message_id (Union[None, Unset, str]):
            reply_to_message (Union['MessageReplyPreview', None, Unset]):
            seq (Union[None, Unset, int]):
            visibility (Union[Unset, int]): MessageVisibility as persisted; PUBLIC by default. Not present in the normalized
                `ChatMessage`.
    """

    id: str
    chat_session_id: str
    sender_type: ChatMessageWireSenderType
    content: str
    message_type: ChatMessageWireMessageType
    created_at: datetime.datetime
    sender_id: Union[None, Unset, str] = UNSET
    metadata: Union[Unset, "ChatMessageWireMetadata"] = UNSET
    reply_to_message_id: Union[None, Unset, str] = UNSET
    reply_to_message: Union["MessageReplyPreview", None, Unset] = UNSET
    seq: Union[None, Unset, int] = UNSET
    visibility: Union[Unset, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
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

        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

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

        seq: Union[None, Unset, int]
        if isinstance(self.seq, Unset):
            seq = UNSET
        else:
            seq = self.seq

        visibility = self.visibility

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
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if reply_to_message_id is not UNSET:
            field_dict["replyToMessageId"] = reply_to_message_id
        if reply_to_message is not UNSET:
            field_dict["replyToMessage"] = reply_to_message
        if seq is not UNSET:
            field_dict["seq"] = seq
        if visibility is not UNSET:
            field_dict["visibility"] = visibility

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.chat_message_wire_metadata import ChatMessageWireMetadata
        from ..models.message_reply_preview import MessageReplyPreview

        d = dict(src_dict)
        id = d.pop("id")

        chat_session_id = d.pop("chatSessionId")

        sender_type = ChatMessageWireSenderType(d.pop("senderType"))

        content = d.pop("content")

        message_type = ChatMessageWireMessageType(d.pop("messageType"))

        created_at = isoparse(d.pop("createdAt"))

        def _parse_sender_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        sender_id = _parse_sender_id(d.pop("senderId", UNSET))

        _metadata = d.pop("metadata", UNSET)
        metadata: Union[Unset, ChatMessageWireMetadata]
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = ChatMessageWireMetadata.from_dict(_metadata)

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

        def _parse_seq(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        seq = _parse_seq(d.pop("seq", UNSET))

        visibility = d.pop("visibility", UNSET)

        chat_message_wire = cls(
            id=id,
            chat_session_id=chat_session_id,
            sender_type=sender_type,
            content=content,
            message_type=message_type,
            created_at=created_at,
            sender_id=sender_id,
            metadata=metadata,
            reply_to_message_id=reply_to_message_id,
            reply_to_message=reply_to_message,
            seq=seq,
            visibility=visibility,
        )

        chat_message_wire.additional_properties = d
        return chat_message_wire

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
