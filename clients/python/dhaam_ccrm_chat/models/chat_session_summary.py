import datetime
from collections.abc import Mapping
from typing import (
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.chat_mode import ChatMode
from ..models.chat_status import ChatStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="ChatSessionSummary")


@_attrs_define
class ChatSessionSummary:
    """Lightweight session projection for history lists. Deliberately smaller than `ChatSession` — a history panel renders
    a label, a timestamp, and an unread badge, and should not pay for participant or ticket payloads it will not draw.

        Attributes:
            id (str): Opaque session identifier.
            status (ChatStatus): The full six-value status set (PRD §12.1, D4) — v1's own type system modeled only four of
                these (`OPEN`/`WAITING_FOR_AGENT`/`ASSIGNED`/ `CLOSED`), silently collapsing `RESOLVED`/`ON_HOLD` traffic to
                `OPEN`.
            mode (ChatMode):
            created_at (datetime.datetime):
            closed_at (Union[None, datetime.datetime]):
            last_message_at (Union[None, datetime.datetime]): Timestamp of the most recent message, or null if the session
                has none.
            unread_count (int): Messages after this customer's read watermark (PRD §9.5).
            last_message_preview (Union[Unset, str]): Truncated plain-text preview of the most recent message.
    """

    id: str
    status: ChatStatus
    mode: ChatMode
    created_at: datetime.datetime
    closed_at: Union[None, datetime.datetime]
    last_message_at: Union[None, datetime.datetime]
    unread_count: int
    last_message_preview: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        status = self.status.value

        mode = self.mode.value

        created_at = self.created_at.isoformat()

        closed_at: Union[None, str]
        if isinstance(self.closed_at, datetime.datetime):
            closed_at = self.closed_at.isoformat()
        else:
            closed_at = self.closed_at

        last_message_at: Union[None, str]
        if isinstance(self.last_message_at, datetime.datetime):
            last_message_at = self.last_message_at.isoformat()
        else:
            last_message_at = self.last_message_at

        unread_count = self.unread_count

        last_message_preview = self.last_message_preview

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "status": status,
                "mode": mode,
                "createdAt": created_at,
                "closedAt": closed_at,
                "lastMessageAt": last_message_at,
                "unreadCount": unread_count,
            }
        )
        if last_message_preview is not UNSET:
            field_dict["lastMessagePreview"] = last_message_preview

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        status = ChatStatus(d.pop("status"))

        mode = ChatMode(d.pop("mode"))

        created_at = isoparse(d.pop("createdAt"))

        def _parse_closed_at(data: object) -> Union[None, datetime.datetime]:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                closed_at_type_0 = isoparse(data)

                return closed_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, datetime.datetime], data)

        closed_at = _parse_closed_at(d.pop("closedAt"))

        def _parse_last_message_at(data: object) -> Union[None, datetime.datetime]:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_message_at_type_0 = isoparse(data)

                return last_message_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, datetime.datetime], data)

        last_message_at = _parse_last_message_at(d.pop("lastMessageAt"))

        unread_count = d.pop("unreadCount")

        last_message_preview = d.pop("lastMessagePreview", UNSET)

        chat_session_summary = cls(
            id=id,
            status=status,
            mode=mode,
            created_at=created_at,
            closed_at=closed_at,
            last_message_at=last_message_at,
            unread_count=unread_count,
            last_message_preview=last_message_preview,
        )

        chat_session_summary.additional_properties = d
        return chat_session_summary

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
