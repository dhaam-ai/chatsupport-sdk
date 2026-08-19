from enum import Enum


class ChatStatus(str, Enum):
    ASSIGNED = "ASSIGNED"
    CLOSED = "CLOSED"
    ON_HOLD = "ON_HOLD"
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"
    WAITING_FOR_AGENT = "WAITING_FOR_AGENT"

    def __str__(self) -> str:
        return str(self.value)
