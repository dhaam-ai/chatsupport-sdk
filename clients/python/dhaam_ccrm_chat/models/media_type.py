from enum import Enum


class MediaType(str, Enum):
    AUDIO = "AUDIO"
    DOCUMENT = "DOCUMENT"
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"

    def __str__(self) -> str:
        return str(self.value)
