import datetime
from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.chat_session import ChatSession


T = TypeVar("T", bound="WebhookSessionUpdatedEvent")


@_attrs_define
class WebhookSessionUpdatedEvent:
    """
    Attributes:
        id (str):
        type_ (Literal['session.updated']):
        created_at (datetime.datetime):
        tenant_id (str):
        data (ChatSession):
    """

    id: str
    type_: Literal["session.updated"]
    created_at: datetime.datetime
    tenant_id: str
    data: "ChatSession"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        created_at = self.created_at.isoformat()

        tenant_id = self.tenant_id

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "type": type_,
                "createdAt": created_at,
                "tenantId": tenant_id,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.chat_session import ChatSession

        d = dict(src_dict)
        id = d.pop("id")

        type_ = cast(Literal["session.updated"], d.pop("type"))
        if type_ != "session.updated":
            raise ValueError(f"type must match const 'session.updated', got '{type_}'")

        created_at = isoparse(d.pop("createdAt"))

        tenant_id = d.pop("tenantId")

        data = ChatSession.from_dict(d.pop("data"))

        webhook_session_updated_event = cls(
            id=id,
            type_=type_,
            created_at=created_at,
            tenant_id=tenant_id,
            data=data,
        )

        webhook_session_updated_event.additional_properties = d
        return webhook_session_updated_event

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
