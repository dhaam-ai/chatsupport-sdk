from enum import Enum


class ListContactCartsStatus(str, Enum):
    ABANDONED = "abandoned"
    CONVERTED = "converted"
    LIVE = "live"

    def __str__(self) -> str:
        return str(self.value)
