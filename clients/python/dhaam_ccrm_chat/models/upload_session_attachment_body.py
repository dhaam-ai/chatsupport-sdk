from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from .. import types

T = TypeVar("T", bound="UploadSessionAttachmentBody")


@_attrs_define
class UploadSessionAttachmentBody:
    """
    Attributes:
        file (str): The file to upload. Accepted categories map to `mediaType` in the response: images, video, audio,
            and common document formats (pdf, doc/docx, xls/xlsx, csv, txt, zip). Exact allow-list and max size are server-
            enforced and not fixed by this spec.
    """

    file: str

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "file": file,
            }
        )

        return field_dict

    def to_multipart(self) -> types.RequestFiles:
        files: types.RequestFiles = []

        files.append(("file", (None, str(self.file).encode(), "text/plain")))

        return files

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        upload_session_attachment_body = cls(
            file=file,
        )

        return upload_session_attachment_body
