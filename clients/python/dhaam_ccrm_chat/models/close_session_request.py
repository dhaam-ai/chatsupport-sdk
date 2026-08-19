from collections.abc import Mapping
from typing import (
    Any,
    TypeVar,
    Union,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.close_reason import CloseReason
from ..types import UNSET, Unset

T = TypeVar("T", bound="CloseSessionRequest")


@_attrs_define
class CloseSessionRequest:
    """
    Attributes:
        reason (Union[Unset, CloseReason]): First-class enum for why a session entered CLOSED (PRD §12.5) — v1 only had
            this as a loose `string | null` code comment (`'SWITCHED' | 'MANUAL' | null`).
    """

    reason: Union[Unset, CloseReason] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        reason: Union[Unset, str] = UNSET
        if not isinstance(self.reason, Unset):
            reason = self.reason.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _reason = d.pop("reason", UNSET)
        reason: Union[Unset, CloseReason]
        if isinstance(_reason, Unset):
            reason = UNSET
        else:
            reason = CloseReason(_reason)

        close_session_request = cls(
            reason=reason,
        )

        close_session_request.additional_properties = d
        return close_session_request

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
