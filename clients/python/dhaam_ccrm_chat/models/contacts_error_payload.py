from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
    Union,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.contacts_error_code import ContactsErrorCode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.contacts_error_payload_details import ContactsErrorPayloadDetails


T = TypeVar("T", bound="ContactsErrorPayload")


@_attrs_define
class ContactsErrorPayload:
    """No `retryable` field — the global error handler never sets one. Its absence means "unknown," not "false"; apply your
    own default retry policy for `429`/`500` rather than reading it from the body.

        Attributes:
            code (ContactsErrorCode): The legacy `ERROR_CODES` vocabulary (`shared/constants/index.ts`), thrown as
                `AppError` and formatted by the global Fastify error handler — see "Contacts / commerce-events surface" above
                for why this, and not `ErrorCode`, is what these four operations actually emit, and for `AUTH_INVALID`'s
                deliberate name-sharing across both vocabularies.
            message (str): Human-readable. Not for programmatic branching — branch on `code`.
            details (Union[Unset, ContactsErrorPayloadDetails]): Structured, error-specific context. Frequently absent.
    """

    code: ContactsErrorCode
    message: str
    details: Union[Unset, "ContactsErrorPayloadDetails"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        details: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.contacts_error_payload_details import ContactsErrorPayloadDetails

        d = dict(src_dict)
        code = ContactsErrorCode(d.pop("code"))

        message = d.pop("message")

        _details = d.pop("details", UNSET)
        details: Union[Unset, ContactsErrorPayloadDetails]
        if isinstance(_details, Unset):
            details = UNSET
        else:
            details = ContactsErrorPayloadDetails.from_dict(_details)

        contacts_error_payload = cls(
            code=code,
            message=message,
            details=details,
        )

        contacts_error_payload.additional_properties = d
        return contacts_error_payload

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
