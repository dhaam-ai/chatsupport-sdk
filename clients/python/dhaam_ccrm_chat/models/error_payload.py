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
    """Identical shape to the WS protocol's ErrorPayload (PRD §7.2) when emitted by the customer surface's auth/rate-limit
    layer. **`retryable` is optional, not required** — corrected from an earlier revision. Errors formatted by the
    global Fastify error handler (`middleware/error-handler.ts:29-38`) and by `POST /upload`'s hand-written error bodies
    never include it; treat its absence as "unknown," not "false." See "Error taxonomy" in the top-level description.

        Attributes:
            code (ErrorCode): Identical to the WS protocol's canonical `ErrorCode` (PRD §7.4) — one enum shared by both
                transports, and genuinely what the customer surface's auth/rate-limit layer emits (`customer-
                auth.middleware.ts`, `rate-limit.ts`). It is **not** the only vocabulary a customer-facing REST error can carry
                — see "Error taxonomy" → "Two vocabularies in practice" in the top-level description for the second, legacy
                vocabulary the business-logic layer actually throws (e.g. `VALIDATION_ERROR` instead of `VALIDATION_FAILED`,
                `INTERNAL_ERROR` instead of `INTERNAL`). Not every value here can occur on every surface (e.g.
                `PROTOCOL_VERSION_UNSUPPORTED` is WS-only).
            message (str): Human-readable. Not for programmatic branching — branch on `code`.
            retryable (Union[Unset, bool]):
            details (Union[Unset, ErrorPayloadDetails]): Structured, error-specific context (e.g. which field failed
                validation).
    """

    code: ErrorCode
    message: str
    retryable: Union[Unset, bool] = UNSET
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
            }
        )
        if retryable is not UNSET:
            field_dict["retryable"] = retryable
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.error_payload_details import ErrorPayloadDetails

        d = dict(src_dict)
        code = ErrorCode(d.pop("code"))

        message = d.pop("message")

        retryable = d.pop("retryable", UNSET)

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
