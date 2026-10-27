"""Cap on paid image generations per run, so a bug cannot run up a bill."""

IMAGES_PER_DAY = 15  # 5 rounds x 3 candidates: what one normal date needs


class BudgetExceeded(Exception):
    """The run has used every image generation it was allowed."""


class Budget:
    def __init__(self, limit: int) -> None:
        self._remaining = limit

    @property
    def remaining(self) -> int:
        return self._remaining

    def spend(self) -> None:
        if self._remaining <= 0:
            raise BudgetExceeded("image generation budget exhausted")
        self._remaining -= 1

    def can_start_day(self) -> bool:
        return self._remaining >= IMAGES_PER_DAY
