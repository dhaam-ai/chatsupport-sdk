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

from ..models.chat_mode import ChatMode
from ..models.chat_status import ChatStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.chat_session_summary_wire_handled_by import (
        ChatSessionSummaryWireHandledBy,
    )


T = TypeVar("T", bound="ChatSessionSummaryWire")


@_attrs_define
class ChatSessionSummaryWire:
    """Wire shape of `GET /chat/sessions/customer`'s `sessions[]` items, as built by `chat.routes.ts`'s `listSessions`
    handler from `chat-session.repository.ts`'s `findCustomerHistory` + `unreadCountsForCustomer`, plus `chat-
    user.service.ts`'s `getUsersByExternalIds` for `handledBy.displayName`. As of this revision this is field-for-field
    the SDK's `ChatSessionSummary` (`packages/core/src/state/types.ts:223-240`) — `status`/`mode` are now the canonical
    v2 STRING enums (D4), and `lastMessageAt` / `lastMessagePreview` / `unreadCount` replace the earlier nested
    `lastMessage` object — plus the additive `handledBy` field below. Still unconsumed by `@dhaam-ccrm/core` as of this
    revision — see the `listSessions` operation's description.

        Attributes:
            id (str): Opaque session identifier.
            status (ChatStatus): The full six-value status set (PRD §12.1, D4) — v1's own type system modeled only four of
                these (`OPEN`/`WAITING_FOR_AGENT`/`ASSIGNED`/ `CLOSED`), silently collapsing `RESOLVED`/`ON_HOLD` traffic to
                `OPEN`.
            mode (ChatMode):
            created_at (datetime.datetime):
            closed_at (Union[None, datetime.datetime]):
            last_message_at (Union[None, datetime.datetime]): Timestamp of the most recent PUBLIC message (§11.2 — INTERNAL
                agent notes never reach a customer-facing response), or `null` if the session has no public message yet.
            unread_count (int): PUBLIC messages not sent by the customer, created after the customer's own read watermark
                for this session (or all such messages if they have never read it). `0`, never absent, when nothing is unread.
            last_message_preview (Union[Unset, str]): Verbatim content of the most recent PUBLIC message. Absent — never an
                empty string — when the session has no public message yet; mirror `lastMessageAt: null` to tell "no preview"
                apart from "preview happens to be empty".
            handled_by (Union[Unset, ChatSessionSummaryWireHandledBy]): Who is/was handling this session. Absent — never
                `null` or a placeholder — when nobody has picked it up yet (e.g. freshly escalated and still unassigned): the
                bot has already handed off and no agent has taken it, so neither `BOT` nor `AGENT` would be a true answer. See
                `buildHandledBy` in `chat.routes.ts` for the exact assigned-agent / still-on-bot / nobody-yet rule.
    """

    id: str
    status: ChatStatus
    mode: ChatMode
    created_at: datetime.datetime
    closed_at: Union[None, datetime.datetime]
    last_message_at: Union[None, datetime.datetime]
    unread_count: int
    last_message_preview: Union[Unset, str] = UNSET
    handled_by: Union[Unset, "ChatSessionSummaryWireHandledBy"] = UNSET
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

        handled_by: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.handled_by, Unset):
            handled_by = self.handled_by.to_dict()

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
        if handled_by is not UNSET:
            field_dict["handledBy"] = handled_by

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.chat_session_summary_wire_handled_by import (
            ChatSessionSummaryWireHandledBy,
        )

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

        _handled_by = d.pop("handledBy", UNSET)
        handled_by: Union[Unset, ChatSessionSummaryWireHandledBy]
        if isinstance(_handled_by, Unset):
            handled_by = UNSET
        else:
            handled_by = ChatSessionSummaryWireHandledBy.from_dict(_handled_by)

        chat_session_summary_wire = cls(
            id=id,
            status=status,
            mode=mode,
            created_at=created_at,
            closed_at=closed_at,
            last_message_at=last_message_at,
            unread_count=unread_count,
            last_message_preview=last_message_preview,
            handled_by=handled_by,
        )

        chat_session_summary_wire.additional_properties = d
        return chat_session_summary_wire

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
