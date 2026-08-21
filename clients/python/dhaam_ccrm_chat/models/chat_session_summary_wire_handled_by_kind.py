from enum import Enum


class ChatSessionSummaryWireHandledByKind(str, Enum):
    AGENT = "AGENT"
    BOT = "BOT"

    def __str__(self) -> str:
        return str(self.value)
