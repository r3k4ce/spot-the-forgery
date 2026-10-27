import pytest

from spot_the_forgery.budget import IMAGES_PER_DAY, Budget, BudgetExceeded


def test_budget_spend_until_exhausted():
    budget = Budget(2)
    budget.spend()
    budget.spend()
    assert budget.remaining == 0
    with pytest.raises(BudgetExceeded):
        budget.spend()


def test_can_start_day_threshold():
    assert IMAGES_PER_DAY == 15
    assert Budget(15).can_start_day()
    assert not Budget(14).can_start_day()
