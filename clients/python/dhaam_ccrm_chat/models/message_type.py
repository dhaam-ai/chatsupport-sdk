from enum import Enum


class MessageType(str, Enum):
    AUDIO = "AUDIO"
    FILE = "FILE"
    IMAGE = "IMAGE"
    SYSTEM = "SYSTEM"
    TEXT = "TEXT"
    VIDEO = "VIDEO"

    def __str__(self) -> str:
        return str(self.value)
