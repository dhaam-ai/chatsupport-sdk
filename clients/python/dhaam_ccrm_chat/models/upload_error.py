from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.upload_error_payload import UploadErrorPayload


T = TypeVar("T", bound="UploadError")


@_attrs_define
class UploadError:
    """
    Attributes:
        success (bool):
        error (UploadErrorPayload): `POST /upload`'s hand-written error shape
            (`upload.routes.ts:88-91,109-111,118-120,127-130,197-203`) — **not** the shared `ErrorPayload`. Only four codes
            are ever emitted, and `retryable` is never present.
    """

    success: bool
    error: "UploadErrorPayload"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "success": success,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.upload_error_payload import UploadErrorPayload

        d = dict(src_dict)
        success = d.pop("success")

        error = UploadErrorPayload.from_dict(d.pop("error"))

        upload_error = cls(
            success=success,
            error=error,
        )

        upload_error.additional_properties = d
        return upload_error

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
