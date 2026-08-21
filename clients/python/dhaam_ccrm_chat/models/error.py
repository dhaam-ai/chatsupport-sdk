from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.error_payload import ErrorPayload


T = TypeVar("T", bound="Error")


@_attrs_define
class Error:
    """
    Attributes:
        error (ErrorPayload): Identical shape to the WS protocol's ErrorPayload (PRD §7.2) when emitted by the customer
            surface's auth/rate-limit layer. **`retryable` is optional, not required** — corrected from an earlier revision.
            Errors formatted by the global Fastify error handler (`middleware/error-handler.ts:29-38`) and by `POST
            /upload`'s hand-written error bodies never include it; treat its absence as "unknown," not "false." See "Error
            taxonomy" in the top-level description.
    """

    error: "ErrorPayload"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.error_payload import ErrorPayload

        d = dict(src_dict)
        error = ErrorPayload.from_dict(d.pop("error"))

        error = cls(
            error=error,
        )

        error.additional_properties = d
        return error

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
