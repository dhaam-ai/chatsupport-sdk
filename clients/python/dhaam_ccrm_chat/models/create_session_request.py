from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
    Union,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_session_request_metadata import CreateSessionRequestMetadata


T = TypeVar("T", bound="CreateSessionRequest")


@_attrs_define
class CreateSessionRequest:
    """Customer identity is derived entirely from the validated `accessToken` — this body never repeats it.

    Attributes:
        metadata (Union[Unset, CreateSessionRequestMetadata]): Optional free-form client-side context (e.g. originating
            page URL, locale).
    """

    metadata: Union[Unset, "CreateSessionRequestMetadata"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_session_request_metadata import (
            CreateSessionRequestMetadata,
        )

        d = dict(src_dict)
        _metadata = d.pop("metadata", UNSET)
        metadata: Union[Unset, CreateSessionRequestMetadata]
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = CreateSessionRequestMetadata.from_dict(_metadata)

        create_session_request = cls(
            metadata=metadata,
        )

        create_session_request.additional_properties = d
        return create_session_request

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
