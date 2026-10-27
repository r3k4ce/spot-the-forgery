import pytest

from spot_the_forgery.budget import Budget, BudgetExceeded


def test_budget_spend_until_exhausted():
    budget = Budget(2)
    budget.spend()
    budget.spend()
    assert budget.remaining == 0
    with pytest.raises(BudgetExceeded):
        budget.spend()
