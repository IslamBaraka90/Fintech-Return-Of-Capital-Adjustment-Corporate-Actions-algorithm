"""Tests for the identity checks, the gross/net comparison, series adjustment and basis runway."""

from __future__ import annotations

from fractions import Fraction

import pytest
from conftest import INPUT, payload, revision, run, run_terms, section

from fintech_return_of_capital import (
    adjust_price_series,
    adjustment_basis_comparison,
    basis_runway,
    calculate,
    verify_views,
)


# --- verify_views ------------------------------------------------------------------- #
def test_the_fixture_closes_on_every_identity():
    report = verify_views(run())
    assert report["ok"] is True
    assert report["priceCloses"] is True
    assert report["factorMatchesPriceRatio"] is True
    assert report["factorsAreReciprocal"] is True
    assert report["returnBreaks"] == []
    assert report["taxBreaks"] == []


def test_a_tampered_theoretical_price_breaks_closure():
    """The positive control: the checker reads the result, it does not assert a constant."""

    result = run()
    result["marketDataAdjustment"]["theoreticalExPrice"] = "24.00000000"
    report = verify_views(result)
    assert report["priceCloses"] is False
    assert report["ok"] is False


def test_a_tampered_factor_is_caught():
    result = run()
    result["marketDataAdjustment"]["backwardHistoryFactor"] = "0.95000000"
    assert verify_views(result)["factorMatchesPriceRatio"] is False


def test_a_forward_factor_that_is_not_the_reciprocal_is_caught():
    result = run()
    result["marketDataAdjustment"]["forwardPostEventFactor"] = "1.50000000"
    assert verify_views(result)["factorsAreReciprocal"] is False


def test_a_net_return_above_the_gross_return_is_caught():
    result = run()
    result["investorReturnDiagnostics"]["netCashReturn"] = "0.50000000"
    checks = [row["check"] for row in verify_views(result)["returnBreaks"]]
    assert "grossTotalReturn >= netCashReturn" in checks


def test_a_negative_basis_is_caught():
    result = run()
    result["usFederalTaxIllustration"]["basisPerShareAfter"] = "-1.00000000"
    checks = [row["check"] for row in verify_views(result)["taxBreaks"]]
    assert "basisPerShareAfter >= 0" in checks


def test_basis_remaining_and_excess_are_mutually_exclusive():
    """You cannot both have basis left and have exceeded it."""

    result = run()
    result["usFederalTaxIllustration"]["excessOverBasisPerShare"] = "0.50000000"
    checks = [row["check"] for row in verify_views(result)["taxBreaks"]]
    assert "basis remaining and excess are mutually exclusive" in checks


def test_the_optional_views_are_reported_as_unchecked_when_absent():
    data = payload()
    del data["exObservation"]
    del data["taxIllustration"]
    report = verify_views(calculate(data))
    assert report["returnsChecked"] is False
    assert report["taxChecked"] is False
    assert report["ok"] is True


def test_a_cancelled_result_is_refused_with_a_clear_reason():
    with pytest.raises(ValueError, match="cancelled"):
        verify_views(run(revisions=[revision(status="cancelled")]))


def test_verification_rejects_foreign_input():
    with pytest.raises(ValueError, match="calculate"):
        verify_views({"state": "confirmed"})


# --- adjustment_basis_comparison ------------------------------------------------------- #
def test_the_wrong_basis_overstates_the_price():
    """Adjusting by the net cash leaves 0.12 of price that should have gone."""

    report = adjustment_basis_comparison(INPUT)
    assert report["correctTheoreticalExPrice"] == "23.00000000"
    assert report["wrongTheoreticalExPrice"] == "23.12000000"
    assert report["priceOverstatedBy"] == "0.12000000"


def test_the_gap_is_exactly_the_deductions():
    report = adjustment_basis_comparison(INPUT)
    assert report["deductionsPerShare"] == "0.12000000"
    assert report["priceOverstatedBy"] == report["deductionsPerShare"]


def test_the_relative_error_is_reported():
    report = adjustment_basis_comparison(INPUT)
    assert Fraction(report["relativeError"]) > 0
    assert report["correctBasis"] == "gross"


def test_the_two_bases_agree_when_there_are_no_deductions():
    data = payload()
    data["revisions"][0]["terms"] = {
        **data["revisions"][0]["terms"],
        "withholdingPerShare": "0.00000000",
        "feesPerShare": "0.00000000",
    }
    report = adjustment_basis_comparison(data)
    assert report["identical"] is True
    assert report["priceOverstatedBy"] == "0.00000000"


def test_the_wrong_factor_is_reported_too():
    report = adjustment_basis_comparison(INPUT)
    assert report["correctBackwardFactor"] == "0.92000000"
    assert report["wrongBackwardFactor"] == "0.92480000"


def test_the_comparison_uses_the_revision_the_result_selected():
    """Reading terms from the wrong revision would misreport the gap."""

    later = revision(
        revisionId="R2", revisionSequence=2,
        observedAt="2025-01-25T14:00:00Z", availableAt="2025-01-25T14:02:00Z",
    )
    later["terms"] = {**later["terms"], "withholdingPerShare": "0.50000000"}
    report = adjustment_basis_comparison(payload(revisions=[INPUT["revisions"][0], later]))
    assert report["deductionsPerShare"] == "0.52000000"


def test_the_comparison_rejects_a_non_object():
    with pytest.raises(TypeError, match="data must be an object"):
        adjustment_basis_comparison("nope")


# --- adjust_price_series ------------------------------------------------------------------ #
def test_the_backward_factor_lands_the_reference_on_the_theoretical_price():
    """Which is the entire point of the factor."""

    row = adjust_price_series(run(), ["25.00000000"])["rows"][0]
    assert row["backwardAdjusted"] == "23.00000000"


def test_both_directions_are_reported():
    """A return of capital is one of the few events where people need both."""

    series = adjust_price_series(run(), ["25.00000000"])
    assert series["backwardHistoryFactor"] == "0.92000000"
    assert series["forwardPostEventFactor"] == "1.08695652"
    assert series["rows"][0]["forwardAdjusted"] != series["rows"][0]["backwardAdjusted"]


def test_relative_moves_within_the_history_are_preserved():
    rows = adjust_price_series(run(), ["20.00000000", "22.00000000"])["rows"]
    raw_ratio = Fraction("22.00000000") / Fraction("20.00000000")
    adjusted_ratio = (
        Fraction(rows[1]["backwardAdjusted"]) / Fraction(rows[0]["backwardAdjusted"])
    )
    assert abs(adjusted_ratio - raw_ratio) < Fraction(1, 10 ** 6)


def test_the_ex_date_step_is_removed():
    series = adjust_price_series(run(), ["25.00000000"])
    assert series["rawExDateStep"] == "-0.08000000"
    assert series["adjustedExDateStep"] == "0.00000000"


def test_prices_are_decimal_strings_in_and_out():
    row = adjust_price_series(run(), ["25.00000000"])["rows"][0]
    assert all(isinstance(value, str) for value in row.values())


@pytest.mark.parametrize("bad", ["0.00000000", "-1.00000000", "abc", 25.0, None])
def test_a_bad_price_raises(bad):
    with pytest.raises((TypeError, ValueError)):
        adjust_price_series(run(), [bad])


def test_an_empty_price_list_raises():
    with pytest.raises(TypeError, match="non-empty list"):
        adjust_price_series(run(), [])


def test_series_adjustment_refuses_a_cancelled_result():
    with pytest.raises(ValueError, match="cancelled"):
        adjust_price_series(run(revisions=[revision(status="cancelled")]), ["25.00000000"])


# --- basis_runway ---------------------------------------------------------------------------- #
def test_the_basis_falls_until_it_is_gone():
    ladder = basis_runway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"])
    assert [row["basisAfter"] for row in ladder["rows"]] == [
        "0.30000000", "0.00000000", "0.00000000",
    ]


def test_the_crossover_payment_is_identified():
    """A taxable event nobody puts in a calendar, arriving on whichever payment crosses."""

    ladder = basis_runway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"])
    assert ladder["basisExhausted"] is True
    assert ladder["exhaustedAtIndex"] == 1
    assert ladder["rows"][1]["excessOverBasis"] == "0.20000000"


def test_everything_after_the_crossover_is_a_gain():
    ladder = basis_runway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"])
    assert ladder["rows"][2]["basisReduction"] == "0.00000000"
    assert ladder["rows"][2]["excessOverBasis"] == "0.30000000"
    assert ladder["totalExcessOverBasis"] == "0.50000000"


def test_the_reductions_and_excesses_account_for_every_payment():
    payments = ["1.20000000", "0.50000000", "0.30000000"]
    ladder = basis_runway("1.50000000", payments)
    total = Fraction(ladder["totalBasisReduction"]) + Fraction(ladder["totalExcessOverBasis"])
    assert total == sum(Fraction(amount) for amount in payments)


def test_a_basis_that_survives_is_reported_as_not_exhausted():
    ladder = basis_runway("5.00000000", ["1.20000000"])
    assert ladder["basisExhausted"] is False
    assert ladder["exhaustedAtIndex"] is None
    assert ladder["basisAfter"] == "3.80000000"


def test_a_zero_basis_makes_every_payment_a_gain():
    ladder = basis_runway("0.00000000", ["1.00000000", "2.00000000"])
    assert ladder["totalBasisReduction"] == "0.00000000"
    assert ladder["totalExcessOverBasis"] == "3.00000000"
    assert ladder["exhaustedAtIndex"] == 0


def test_an_empty_payment_list_raises():
    with pytest.raises(TypeError, match="non-empty list"):
        basis_runway("1.50000000", [])


@pytest.mark.parametrize("bad", ["-1.00000000", "abc", 1.5, None])
def test_a_bad_payment_amount_raises(bad):
    with pytest.raises((TypeError, ValueError)):
        basis_runway("1.50000000", [bad])


# --- the surfaces agree ------------------------------------------------------------------------ #
def test_the_single_event_runway_matches_the_tax_illustration():
    """The runway is the same arithmetic, run over a sequence instead of one payment."""

    tax = run()["usFederalTaxIllustration"]
    ladder = basis_runway("1.50000000", ["1.20000000"])
    assert ladder["rows"][0]["basisReduction"] == tax["basisReductionPerShare"]
    assert ladder["rows"][0]["basisAfter"] == tax["basisPerShareAfter"]
    assert ladder["rows"][0]["excessOverBasis"] == tax["excessOverBasisPerShare"]


def test_the_correct_comparison_branch_matches_the_calculation():
    report = adjustment_basis_comparison(INPUT)
    market = run()["marketDataAdjustment"]
    assert report["correctTheoreticalExPrice"] == market["theoreticalExPrice"]
    assert report["correctBackwardFactor"] == market["backwardHistoryFactor"]
