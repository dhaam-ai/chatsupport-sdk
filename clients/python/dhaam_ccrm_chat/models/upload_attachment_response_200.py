from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.upload_response import UploadResponse


T = TypeVar("T", bound="UploadAttachmentResponse200")


@_attrs_define
class UploadAttachmentResponse200:
    """
    Attributes:
        success (bool):
        data (UploadResponse): Actual `data` payload of `POST /upload`'s `200` response (`upload.routes.ts:166-175`).
            Distinct from the idealized `Attachment` schema above — most notably `mediaType` is lowercase-plural here, not
            the `IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT` enum `Attachment.mediaType` documents. See `MediaType`'s description for
            the adapter's mapping between the two.
    """

    success: bool
    data: "UploadResponse"
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
        from ..models.upload_response import UploadResponse

        d = dict(src_dict)
        success = d.pop("success")

        data = UploadResponse.from_dict(d.pop("data"))

        upload_attachment_response_200 = cls(
            success=success,
            data=data,
        )

        upload_attachment_response_200.additional_properties = d
        return upload_attachment_response_200

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
