from enum import Enum


class ParticipantType(str, Enum):
    AGENT = "AGENT"
    BOT = "BOT"
    CUSTOMER = "CUSTOMER"

    def __str__(self) -> str:
        return str(self.value)
