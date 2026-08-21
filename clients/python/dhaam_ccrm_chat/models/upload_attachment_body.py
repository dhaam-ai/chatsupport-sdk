from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from .. import types

T = TypeVar("T", bound="UploadAttachmentBody")


@_attrs_define
class UploadAttachmentBody:
    """
    Attributes:
        file (str): The file to upload. See the allow-list above.
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

        upload_attachment_body = cls(
            file=file,
        )

        return upload_attachment_body
