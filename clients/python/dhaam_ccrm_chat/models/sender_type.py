from enum import Enum


class SenderType(str, Enum):
    AGENT = "AGENT"
    BOT = "BOT"
    CUSTOMER = "CUSTOMER"
    SYSTEM = "SYSTEM"

    def __str__(self) -> str:
        return str(self.value)
