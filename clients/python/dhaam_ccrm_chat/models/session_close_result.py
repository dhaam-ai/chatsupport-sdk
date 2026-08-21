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

T = TypeVar("T", bound="SessionCloseResult")


@_attrs_define
class SessionCloseResult:
    """Actual `data` payload of `POST /chat/sessions/{sessionId}/close`'s `200` response (`chat.routes.ts:289-292`).

    Attributes:
        session_id (str):
        status (int): Raw integer `ChatStatus` code — will be 4 (CLOSED) on a fresh close, but reflects whatever the
            row's current status is on the naturally-idempotent repeat-call path.
        closed_at (Union[None, datetime.datetime]):
    """

    session_id: str
    status: int
    closed_at: Union[None, datetime.datetime]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        status = self.status

        closed_at: Union[None, str]
        if isinstance(self.closed_at, datetime.datetime):
            closed_at = self.closed_at.isoformat()
        else:
            closed_at = self.closed_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionId": session_id,
                "status": status,
                "closedAt": closed_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionId")

        status = d.pop("status")

        def _parse_closed_at(data: object) -> Union[None, datetime.datetime]:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                closed_at_type_0 = isoparse(data)

                return closed_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, datetime.datetime], data)

        closed_at = _parse_closed_at(d.pop("closedAt"))

        session_close_result = cls(
            session_id=session_id,
            status=status,
            closed_at=closed_at,
        )

        session_close_result.additional_properties = d
        return session_close_result

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
