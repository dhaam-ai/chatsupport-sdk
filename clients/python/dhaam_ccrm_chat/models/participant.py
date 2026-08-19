import datetime
from collections.abc import Mapping
from typing import (
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.participant_type import ParticipantType
from ..types import UNSET, Unset

T = TypeVar("T", bound="Participant")


@_attrs_define
class Participant:
    """
    Attributes:
        participant_type (ParticipantType): Who a session participant is. Distinct from SenderType — a participant has
            no SYSTEM value.
        last_read_at (Union[None, datetime.datetime]): The read watermark model (PRD §9.5, §12.9). Null if this
            participant has not read any messages yet. When multiple AGENT participants exist, a client should take the
            maximum `lastReadAt` across them.
        user_id (Union[None, Unset, str]): Opaque identifier of the participant, null for a BOT participant.
    """

    participant_type: ParticipantType
    last_read_at: Union[None, datetime.datetime]
    user_id: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        participant_type = self.participant_type.value

        last_read_at: Union[None, str]
        if isinstance(self.last_read_at, datetime.datetime):
            last_read_at = self.last_read_at.isoformat()
        else:
            last_read_at = self.last_read_at

        user_id: Union[None, Unset, str]
        if isinstance(self.user_id, Unset):
            user_id = UNSET
        else:
            user_id = self.user_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "participantType": participant_type,
                "lastReadAt": last_read_at,
            }
        )
        if user_id is not UNSET:
            field_dict["userId"] = user_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        participant_type = ParticipantType(d.pop("participantType"))

        def _parse_last_read_at(data: object) -> Union[None, datetime.datetime]:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_read_at_type_0 = isoparse(data)

                return last_read_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, datetime.datetime], data)

        last_read_at = _parse_last_read_at(d.pop("lastReadAt"))

        def _parse_user_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        user_id = _parse_user_id(d.pop("userId", UNSET))

        participant = cls(
            participant_type=participant_type,
            last_read_at=last_read_at,
            user_id=user_id,
        )

        participant.additional_properties = d
        return participant

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
