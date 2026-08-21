from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.media_type import MediaType

T = TypeVar("T", bound="Attachment")


@_attrs_define
class Attachment:
    """
    Attributes:
        url (str):
        file_name (str):
        mime_type (str):
        size (int): Size in bytes.
        media_type (MediaType): Attachment category, upper-snake-case, for consistency with every other enum in this
            document (D4). **Confirmed, not merely proposed**: this is the shape `@dhaam-ccrm/core`'s `messageTypeFor`
            (`packages/core/src/messages/controller.ts:87-97`) requires, and it is never what the wire actually sends —
            `POST /upload` always returns lowercase-plural values (see `UploadResponse.mediaType`). `@dhaam-ccrm/rest`'s
            `createAttachmentUploader` adapter performs this exact mapping (`packages/rest/src/media-type.ts`) before
            handing an `Attachment` to core:
            | Wire value (`UploadResponse.mediaType`) | This enum | |---|---| | `images` | `IMAGE` | | `videos` | `VIDEO` |
            | `audio` | `AUDIO` | | `documents` | `DOCUMENT` |
    """

    url: str
    file_name: str
    mime_type: str
    size: int
    media_type: MediaType
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        file_name = self.file_name

        mime_type = self.mime_type

        size = self.size

        media_type = self.media_type.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "url": url,
                "fileName": file_name,
                "mimeType": mime_type,
                "size": size,
                "mediaType": media_type,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        file_name = d.pop("fileName")

        mime_type = d.pop("mimeType")

        size = d.pop("size")

        media_type = MediaType(d.pop("mediaType"))

        attachment = cls(
            url=url,
            file_name=file_name,
            mime_type=mime_type,
            size=size,
            media_type=media_type,
        )

        attachment.additional_properties = d
        return attachment

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
