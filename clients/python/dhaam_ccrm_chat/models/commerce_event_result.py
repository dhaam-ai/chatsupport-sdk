from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.commerce_event_result_type import CommerceEventResultType

T = TypeVar("T", bound="CommerceEventResult")


@_attrs_define
class CommerceEventResult:
    """Response `data` for both write operations, first application or replay alike.

    Attributes:
        event_id (str):
        type_ (CommerceEventResultType):
        contact_id (str): The resolved (machine path) or path-supplied (admin path) contact's opaque id — same
            identifier `GET /contacts/:id` returns as `id`.
        applied (bool): `false` only when this `eventId` had already been accepted and processed before — a replay. The
            mutation is not re-applied; these fields are read back from the original stored event, not recomputed. `true` on
            first acceptance AND on an accepted no-op (e.g. `cart.abandoned` repeated against an already- `ABANDONED` cart,
            or a stale out-of-order `cart.updated`) — `applied` distinguishes "have I seen this `eventId` before," not "did
            this event change any state."
    """

    event_id: str
    type_: CommerceEventResultType
    contact_id: str
    applied: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_.value

        contact_id = self.contact_id

        applied = self.applied

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "eventId": event_id,
                "type": type_,
                "contactId": contact_id,
                "applied": applied,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = CommerceEventResultType(d.pop("type"))

        contact_id = d.pop("contactId")

        applied = d.pop("applied")

        commerce_event_result = cls(
            event_id=event_id,
            type_=type_,
            contact_id=contact_id,
            applied=applied,
        )

        commerce_event_result.additional_properties = d
        return commerce_event_result

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
