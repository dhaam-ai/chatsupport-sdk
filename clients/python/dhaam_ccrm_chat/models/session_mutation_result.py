from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="SessionMutationResult")


@_attrs_define
class SessionMutationResult:
    """Actual `data` payload of `POST /chat/sessions`'s `201` response and `POST /chat/sessions/{sessionId}/reopen`'s `200`
    response (`chat.routes.ts:217-218,312-313`) — both build their reply from exactly these three fields and nothing
    else. `status`/`mode` are raw integer codes, and the id field is named `sessionId`, not `id` — unlike `ChatSession`.

        Attributes:
            session_id (str):
            status (int): 1=OPEN, 2=WAITING_FOR_AGENT, 3=ASSIGNED, 4=CLOSED, 5=RESOLVED, 6=ON_HOLD
                (`shared/constants/enums.ts:15-22`).
            mode (int): 1=BOT, 2=HUMAN (`shared/constants/enums.ts:24-27`).
    """

    session_id: str
    status: int
    mode: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        status = self.status

        mode = self.mode

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionId": session_id,
                "status": status,
                "mode": mode,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionId")

        status = d.pop("status")

        mode = d.pop("mode")

        session_mutation_result = cls(
            session_id=session_id,
            status=status,
            mode=mode,
        )

        session_mutation_result.additional_properties = d
        return session_mutation_result

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
