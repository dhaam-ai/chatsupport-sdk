from enum import Enum


class ChatMode(str, Enum):
    BOT = "BOT"
    HUMAN = "HUMAN"

    def __str__(self) -> str:
        return str(self.value)
