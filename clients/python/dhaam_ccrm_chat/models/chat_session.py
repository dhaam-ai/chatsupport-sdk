import datetime
from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    TypeVar,
    Union,
    cast,
)

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.chat_mode import ChatMode
from ..models.chat_status import ChatStatus

if TYPE_CHECKING:
    from ..models.profile import Profile
    from ..models.ticket import Ticket


T = TypeVar("T", bound="ChatSession")


@_attrs_define
class ChatSession:
    """
    Attributes:
        id (str): Opaque session identifier.
        status (ChatStatus): The full six-value status set (PRD §12.1, D4) — v1's own type system modeled only four of
            these (`OPEN`/`WAITING_FOR_AGENT`/`ASSIGNED`/ `CLOSED`), silently collapsing `RESOLVED`/`ON_HOLD` traffic to
            `OPEN`.
        mode (ChatMode):
        created_at (datetime.datetime):
        closed_at (Union[None, datetime.datetime]):
        assigned_agent (Union['Profile', None]):
        customer (Union['Profile', None]):
        ticket (Union['Ticket', None]):
    """

    id: str
    status: ChatStatus
    mode: ChatMode
    created_at: datetime.datetime
    closed_at: Union[None, datetime.datetime]
    assigned_agent: Union["Profile", None]
    customer: Union["Profile", None]
    ticket: Union["Ticket", None]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.profile import Profile
        from ..models.ticket import Ticket

        id = self.id

        status = self.status.value

        mode = self.mode.value

        created_at = self.created_at.isoformat()

        closed_at: Union[None, str]
        if isinstance(self.closed_at, datetime.datetime):
            closed_at = self.closed_at.isoformat()
        else:
            closed_at = self.closed_at

        assigned_agent: Union[None, dict[str, Any]]
        if isinstance(self.assigned_agent, Profile):
            assigned_agent = self.assigned_agent.to_dict()
        else:
            assigned_agent = self.assigned_agent

        customer: Union[None, dict[str, Any]]
        if isinstance(self.customer, Profile):
            customer = self.customer.to_dict()
        else:
            customer = self.customer

        ticket: Union[None, dict[str, Any]]
        if isinstance(self.ticket, Ticket):
            ticket = self.ticket.to_dict()
        else:
            ticket = self.ticket

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "status": status,
                "mode": mode,
                "createdAt": created_at,
                "closedAt": closed_at,
                "assignedAgent": assigned_agent,
                "customer": customer,
                "ticket": ticket,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.profile import Profile
        from ..models.ticket import Ticket

        d = dict(src_dict)
        id = d.pop("id")

        status = ChatStatus(d.pop("status"))

        mode = ChatMode(d.pop("mode"))

        created_at = isoparse(d.pop("createdAt"))

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

        def _parse_assigned_agent(data: object) -> Union["Profile", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                assigned_agent_type_0 = Profile.from_dict(data)

                return assigned_agent_type_0
            except:  # noqa: E722
                pass
            return cast(Union["Profile", None], data)

        assigned_agent = _parse_assigned_agent(d.pop("assignedAgent"))

        def _parse_customer(data: object) -> Union["Profile", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                customer_type_0 = Profile.from_dict(data)

                return customer_type_0
            except:  # noqa: E722
                pass
            return cast(Union["Profile", None], data)

        customer = _parse_customer(d.pop("customer"))

        def _parse_ticket(data: object) -> Union["Ticket", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                ticket_type_0 = Ticket.from_dict(data)

                return ticket_type_0
            except:  # noqa: E722
                pass
            return cast(Union["Ticket", None], data)

        ticket = _parse_ticket(d.pop("ticket"))

        chat_session = cls(
            id=id,
            status=status,
            mode=mode,
            created_at=created_at,
            closed_at=closed_at,
            assigned_agent=assigned_agent,
            customer=customer,
            ticket=ticket,
        )

        chat_session.additional_properties = d
        return chat_session

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
