from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
    Union,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.error_code import ErrorCode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.error_payload_details import ErrorPayloadDetails


T = TypeVar("T", bound="ErrorPayload")


@_attrs_define
class ErrorPayload:
    """Identical shape to the WS protocol's ErrorPayload (PRD §7.2).

    Attributes:
        code (ErrorCode): Identical to the WS protocol's canonical `ErrorCode` (PRD §7.4) — one enum shared by both
            transports. Not every value can occur on every surface (e.g. `PROTOCOL_VERSION_UNSUPPORTED` is WS-only); see
            this document's top-level Error Taxonomy table for the REST-specific subset and HTTP status mapping.
        message (str): Human-readable. Not for programmatic branching — branch on `code`.
        retryable (bool):
        details (Union[Unset, ErrorPayloadDetails]): Structured, error-specific context (e.g. which field failed
            validation).
    """

    code: ErrorCode
    message: str
    retryable: bool
    details: Union[Unset, "ErrorPayloadDetails"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        retryable = self.retryable

        details: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
                "message": message,
                "retryable": retryable,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.error_payload_details import ErrorPayloadDetails

        d = dict(src_dict)
        code = ErrorCode(d.pop("code"))

        message = d.pop("message")

        retryable = d.pop("retryable")

        _details = d.pop("details", UNSET)
        details: Union[Unset, ErrorPayloadDetails]
        if isinstance(_details, Unset):
            details = UNSET
        else:
            details = ErrorPayloadDetails.from_dict(_details)

        error_payload = cls(
            code=code,
            message=message,
            retryable=retryable,
            details=details,
        )

        error_payload.additional_properties = d
        return error_payload

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
