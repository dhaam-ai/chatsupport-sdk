from collections.abc import Mapping
from typing import (
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="Profile")


@_attrs_define
class Profile:
    """Enriched participant profile, generalized from v1's assignedAgent/customer shapes.

    Attributes:
        participant_id (str): Correlation key. `presence.update` frames and `readWatermarks` are both keyed by this, so
            without it neither can be bound to a person.
        display_name (str):
        email (Union[None, str]):
        avatar_url (Union[None, str]):
    """

    participant_id: str
    display_name: str
    email: Union[None, str]
    avatar_url: Union[None, str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        participant_id = self.participant_id

        display_name = self.display_name

        email: Union[None, str]
        email = self.email

        avatar_url: Union[None, str]
        avatar_url = self.avatar_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "participantId": participant_id,
                "displayName": display_name,
                "email": email,
                "avatarUrl": avatar_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        participant_id = d.pop("participantId")

        display_name = d.pop("displayName")

        def _parse_email(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        email = _parse_email(d.pop("email"))

        def _parse_avatar_url(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        avatar_url = _parse_avatar_url(d.pop("avatarUrl"))

        profile = cls(
            participant_id=participant_id,
            display_name=display_name,
            email=email,
            avatar_url=avatar_url,
        )

        profile.additional_properties = d
        return profile

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
