from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="MintTokenResponse")


@_attrs_define
class MintTokenResponse:
    """
    Attributes:
        access_token (str): Short-lived JWT. Pass to the SDK via `getToken()` (PRD §6.1).
        expires_in (int): Token lifetime in seconds from the moment of minting.
    """

    access_token: str
    expires_in: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        access_token = self.access_token

        expires_in = self.expires_in

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "accessToken": access_token,
                "expiresIn": expires_in,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        access_token = d.pop("accessToken")

        expires_in = d.pop("expiresIn")

        mint_token_response = cls(
            access_token=access_token,
            expires_in=expires_in,
        )

        mint_token_response.additional_properties = d
        return mint_token_response

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
