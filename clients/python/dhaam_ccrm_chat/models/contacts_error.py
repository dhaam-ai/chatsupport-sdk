from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.contacts_error_payload import ContactsErrorPayload


T = TypeVar("T", bound="ContactsError")


@_attrs_define
class ContactsError:
    """
    Attributes:
        success (bool):
        error (ContactsErrorPayload): No `retryable` field — the global error handler never sets one. Its absence means
            "unknown," not "false"; apply your own default retry policy for `429`/`500` rather than reading it from the
            body.
    """

    success: bool
    error: "ContactsErrorPayload"
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
        from ..models.contacts_error_payload import ContactsErrorPayload

        d = dict(src_dict)
        success = d.pop("success")

        error = ContactsErrorPayload.from_dict(d.pop("error"))

        contacts_error = cls(
            success=success,
            error=error,
        )

        contacts_error.additional_properties = d
        return contacts_error

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
