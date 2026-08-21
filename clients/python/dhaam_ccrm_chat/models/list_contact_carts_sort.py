from enum import Enum


class ListContactCartsSort(str, Enum):
    CARTVALUEASC = "cartValue:asc"
    CARTVALUEDESC = "cartValue:desc"
    UPDATEDATASC = "updatedAt:asc"
    UPDATEDATDESC = "updatedAt:desc"

    def __str__(self) -> str:
        return str(self.value)
