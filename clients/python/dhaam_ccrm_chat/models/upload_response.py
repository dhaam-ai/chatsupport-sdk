from collections.abc import Mapping
from typing import (
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.upload_response_media_type import UploadResponseMediaType
from ..types import UNSET, Unset

T = TypeVar("T", bound="UploadResponse")


@_attrs_define
class UploadResponse:
    """Actual `data` payload of `POST /upload`'s `200` response (`upload.routes.ts:166-175`). Distinct from the idealized
    `Attachment` schema above — most notably `mediaType` is lowercase-plural here, not the
    `IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT` enum `Attachment.mediaType` documents. See `MediaType`'s description for the
    adapter's mapping between the two.

        Attributes:
            url (str):
            file_name (str):
            mime_type (str):
            size (int): Size in bytes.
            media_type (UploadResponseMediaType): The S3 storage folder the file was categorized into
                (`s3-client.ts:38-44`), echoed back verbatim. Lowercase, plural — see this schema's top-level description.
            chat_session_id (Union[None, Unset, str]): Echoes the request's `chatSessionId` query parameter, or absent if
                none was supplied.
    """

    url: str
    file_name: str
    mime_type: str
    size: int
    media_type: UploadResponseMediaType
    chat_session_id: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        file_name = self.file_name

        mime_type = self.mime_type

        size = self.size

        media_type = self.media_type.value

        chat_session_id: Union[None, Unset, str]
        if isinstance(self.chat_session_id, Unset):
            chat_session_id = UNSET
        else:
            chat_session_id = self.chat_session_id

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
        if chat_session_id is not UNSET:
            field_dict["chatSessionId"] = chat_session_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        file_name = d.pop("fileName")

        mime_type = d.pop("mimeType")

        size = d.pop("size")

        media_type = UploadResponseMediaType(d.pop("mediaType"))

        def _parse_chat_session_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        chat_session_id = _parse_chat_session_id(d.pop("chatSessionId", UNSET))

        upload_response = cls(
            url=url,
            file_name=file_name,
            mime_type=mime_type,
            size=size,
            media_type=media_type,
            chat_session_id=chat_session_id,
        )

        upload_response.additional_properties = d
        return upload_response

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
