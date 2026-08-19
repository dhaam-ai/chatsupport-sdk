from enum import Enum


class CloseReason(str, Enum):
    MANUAL = "MANUAL"
    SWITCHED = "SWITCHED"

    def __str__(self) -> str:
        return str(self.value)
