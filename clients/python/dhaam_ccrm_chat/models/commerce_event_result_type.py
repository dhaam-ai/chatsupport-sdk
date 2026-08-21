from enum import Enum


class CommerceEventResultType(str, Enum):
    CART_ABANDONED = "cart.abandoned"
    CART_CONVERTED = "cart.converted"
    CART_UPDATED = "cart.updated"
    ORDER_CANCELLED = "order.cancelled"
    ORDER_COMPLETED = "order.completed"
    ORDER_PLACED = "order.placed"

    def __str__(self) -> str:
        return str(self.value)
