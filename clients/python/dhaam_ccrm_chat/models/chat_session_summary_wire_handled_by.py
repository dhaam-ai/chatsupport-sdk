from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.chat_session_summary_wire_handled_by_kind import (
    ChatSessionSummaryWireHandledByKind,
)

T = TypeVar("T", bound="ChatSessionSummaryWireHandledBy")


@_attrs_define
class ChatSessionSummaryWireHandledBy:
    """Who is/was handling this session. Absent — never `null` or a placeholder — when nobody has picked it up yet (e.g.
    freshly escalated and still unassigned): the bot has already handed off and no agent has taken it, so neither `BOT`
    nor `AGENT` would be a true answer. See `buildHandledBy` in `chat.routes.ts` for the exact assigned-agent / still-
    on-bot / nobody-yet rule.

        Attributes:
            kind (ChatSessionSummaryWireHandledByKind):
            id (str): The agent's external id for `kind: AGENT` (falls back to that id as `displayName` too, if the
                `ChatUser` display-name cache has no entry). A fixed sentinel (`"bot"`) for `kind: BOT` — there is no per-tenant
                bot identity anywhere in the schema today.
            display_name (str):
    """

    kind: ChatSessionSummaryWireHandledByKind
    id: str
    display_name: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind.value

        id = self.id

        display_name = self.display_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "id": id,
                "displayName": display_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = ChatSessionSummaryWireHandledByKind(d.pop("kind"))

        id = d.pop("id")

        display_name = d.pop("displayName")

        chat_session_summary_wire_handled_by = cls(
            kind=kind,
            id=id,
            display_name=display_name,
        )

        chat_session_summary_wire_handled_by.additional_properties = d
        return chat_session_summary_wire_handled_by

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
