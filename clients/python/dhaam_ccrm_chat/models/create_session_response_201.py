from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.session_mutation_result import SessionMutationResult


T = TypeVar("T", bound="CreateSessionResponse201")


@_attrs_define
class CreateSessionResponse201:
    """
    Attributes:
        success (bool):
        data (SessionMutationResult): Actual `data` payload of `POST /chat/sessions`'s `201` response and `POST
            /chat/sessions/{sessionId}/reopen`'s `200` response (`chat.routes.ts:217-218,312-313`) — both build their reply
            from exactly these three fields and nothing else. `status`/`mode` are raw integer codes, and the id field is
            named `sessionId`, not `id` — unlike `ChatSession`.
    """

    success: bool
    data: "SessionMutationResult"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "success": success,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_mutation_result import SessionMutationResult

        d = dict(src_dict)
        success = d.pop("success")

        data = SessionMutationResult.from_dict(d.pop("data"))

        create_session_response_201 = cls(
            success=success,
            data=data,
        )

        create_session_response_201.additional_properties = d
        return create_session_response_201

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
