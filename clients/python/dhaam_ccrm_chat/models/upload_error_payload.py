from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.upload_error_payload_code import UploadErrorPayloadCode

T = TypeVar("T", bound="UploadErrorPayload")


@_attrs_define
class UploadErrorPayload:
    """`POST /upload`'s hand-written error shape (`upload.routes.ts:88-91,109-111,118-120,127-130,197-203`) — **not** the
    shared `ErrorPayload`. Only four codes are ever emitted, and `retryable` is never present.

        Attributes:
            code (UploadErrorPayloadCode):
            message (str):
    """

    code: UploadErrorPayloadCode
    message: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code = UploadErrorPayloadCode(d.pop("code"))

        message = d.pop("message")

        upload_error_payload = cls(
            code=code,
            message=message,
        )

        upload_error_payload.additional_properties = d
        return upload_error_payload

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
