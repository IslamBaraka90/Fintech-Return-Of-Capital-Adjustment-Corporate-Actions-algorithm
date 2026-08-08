"""Contract tests for the return-of-capital adjustment.

The fixture is the cross-language acceptance anchor: a 2.00 USD capital return against a
25.00 close, with 0.10 withholding and 0.02 fees, an observed ex close, and a US federal tax
illustration against a 1.50 basis. Its complete expected output is asserted verbatim here and
by the TypeScript suite.
"""

from __future__ import annotations

from fractions import Fraction

import pytest
from conftest import CASE_LABEL, EXPECTED, INPUT, R1, TOPIC_ID, payload, revision, run, run_terms, section

from fintech_return_of_capital import (
    US_TAX_SCOPE,
    calculate,
    parse_decimal,
    parse_instant,
    render,
    select_revision,
)


# --- the shared fixture ------------------------------------------------------------ #
def test_the_whole_result_matches_the_fixture():
    assert calculate(INPUT) == EXPECTED


def test_the_fixture_is_the_documented_topic():
    assert TOPIC_ID == "D02-F02-A05"
    assert "synthetic" in CASE_LABEL.lower()


def test_the_exact_worked_values():
    market = run()["marketDataAdjustment"]
    assert market["referencePrice"] == "25.00000000"
    assert market["grossDistributionInPriceCurrency"] == "2.00000000"
    assert market["theoreticalExPrice"] == "23.00000000"
    assert market["backwardHistoryFactor"] == "0.92000000"
    assert market["forwardPostEventFactor"] == "1.08695652"


def test_every_monetary_value_is_a_decimal_string():
    """No float crosses the interface in either direction."""

    market = run()["marketDataAdjustment"]
    for key, value in market.items():
        if key in {"factorDirection", "theoreticalPriceIsObservedTrade"}:
            continue
        assert isinstance(value, str)
        assert len(value.split(".")[1]) == 8


def test_the_theoretical_price_is_not_a_trade():
    assert run()["marketDataAdjustment"]["theoreticalPriceIsObservedTrade"] is False


def test_the_factor_direction_is_published():
    assert run()["marketDataAdjustment"]["factorDirection"] == \
        "multiply_pre_ex_history_by_backwardHistoryFactor"


# --- the three views stay apart ---------------------------------------------------------- #
def test_the_price_adjustment_uses_the_gross_amount():
    """What left the company, not what any particular holder received."""

    market = run()["marketDataAdjustment"]
    assert market["grossDistributionInPriceCurrency"] == "2.00000000"
    # Net would be 1.88, and would produce 23.12 rather than 23.
    assert market["theoreticalExPrice"] == "23.00000000"


def test_the_return_diagnostics_give_three_different_answers():
    returns = run()["investorReturnDiagnostics"]
    assert returns["rawPriceReturn"] == "-0.07400000"
    assert returns["grossTotalReturn"] == "0.00600000"
    assert returns["netCashReturn"] == "0.00120000"


def test_the_price_alone_understates_the_outcome():
    """A 7.4% 'fall' that is mostly cash the holder received."""

    returns = run()["investorReturnDiagnostics"]
    assert Fraction(returns["rawPriceReturn"]) < 0
    assert Fraction(returns["netCashReturn"]) > 0


def test_withholding_and_fees_only_appear_in_the_net_return():
    returns = run()["investorReturnDiagnostics"]
    assert Fraction(returns["grossTotalReturn"]) > Fraction(returns["netCashReturn"])
    market = run()["marketDataAdjustment"]
    # And nowhere in the price adjustment.
    assert market["grossDistributionInPriceCurrency"] == "2.00000000"


def test_the_tax_illustration_reduces_basis():
    tax = run()["usFederalTaxIllustration"]
    assert tax["basisReductionPerShare"] == "1.20000000"
    assert tax["basisPerShareAfter"] == "0.30000000"
    assert tax["excessOverBasisPerShare"] == "0.00000000"


def test_the_tax_view_uses_the_classified_amount_not_the_distribution():
    """The issuer distributed 2.00 and classified only 1.20 as return of capital."""

    tax = run()["usFederalTaxIllustration"]
    assert tax["basisReductionPerShare"] == "1.20000000"
    assert run()["marketDataAdjustment"]["grossDistributionInPriceCurrency"] == "2.00000000"


def test_a_classification_above_the_basis_becomes_an_excess():
    """Basis floors at zero and the remainder is a gain, not a further reduction."""

    tax = run(taxIllustration=section(
        "taxIllustration", confirmedReturnOfCapitalPerShare="1.80000000",
    ))["usFederalTaxIllustration"]
    assert tax["basisReductionPerShare"] == "1.50000000"
    assert tax["basisPerShareAfter"] == "0.00000000"
    assert tax["excessOverBasisPerShare"] == "0.30000000"


def test_a_classification_above_the_distribution_raises():
    with pytest.raises(ValueError, match="cannot exceed the gross distribution"):
        run(taxIllustration=section(
            "taxIllustration", confirmedReturnOfCapitalPerShare="3.00000000",
        ))


def test_the_tax_illustration_is_scoped_to_one_jurisdiction():
    with pytest.raises(ValueError, match=US_TAX_SCOPE):
        run(taxIllustration=section("taxIllustration", jurisdiction="UK_2025"))


def test_the_tax_illustration_requires_usd():
    with pytest.raises(ValueError, match="requires USD"):
        run(taxIllustration=section("taxIllustration", currency="EUR"))


def test_the_optional_views_are_genuinely_optional():
    data = payload()
    del data["exObservation"]
    del data["taxIllustration"]
    result = calculate(data)
    assert result["investorReturnDiagnostics"] is None
    assert result["usFederalTaxIllustration"] is None
    assert result["marketDataAdjustment"]["theoreticalExPrice"] == "23.00000000"


# --- decimal strings, not floats ------------------------------------------------------------ #
@pytest.mark.parametrize("bad", [2.0, 2, None, True, [], {}])
def test_a_non_string_amount_raises(bad):
    with pytest.raises(TypeError, match="plain decimal string"):
        run_terms(grossCapitalReturnPerShare=bad)


@pytest.mark.parametrize("bad", ["2e0", "2E0", "1e-8"])
def test_exponent_notation_is_refused(bad):
    """It is not a *plain* decimal, and accepting it would blur the published precision."""

    with pytest.raises(TypeError, match="plain decimal string"):
        run_terms(grossCapitalReturnPerShare=bad)


@pytest.mark.parametrize("bad", ["-1.00", "abc", "", "1.2.3", " 1.0"])
def test_a_malformed_or_negative_amount_raises(bad):
    with pytest.raises((TypeError, ValueError)):
        run_terms(grossCapitalReturnPerShare=bad)


def test_more_than_eight_decimal_places_raises():
    """Silently truncating a ninth would be worse than saying so."""

    with pytest.raises(ValueError, match="at most 8 decimal places"):
        run_terms(grossCapitalReturnPerShare="2.000000001")


def test_exactly_eight_decimal_places_is_accepted():
    assert run_terms(grossCapitalReturnPerShare="2.00000001")["applied"] is True


def test_a_zero_price_raises():
    with pytest.raises(ValueError, match="must be positive"):
        run(referenceObservation=section("referenceObservation", price="0.00000000"))


def test_rendering_is_half_away_from_zero():
    assert render(Fraction(1, 2 * 10 ** 8)) == "0.00000001"
    assert render(Fraction(-1, 2 * 10 ** 8)) == "-0.00000001"


def test_rendering_always_pads_to_eight_places():
    assert render(Fraction(1)) == "1.00000000"
    assert render(Fraction(0)) == "0.00000000"


def test_parse_decimal_returns_an_exact_rational():
    """0.1 as a string is exactly 1/10; as a float it is not."""

    assert parse_decimal("0.10000000", "x") == Fraction(1, 10)
    assert parse_decimal("0.10000000", "x") + parse_decimal("0.20000000", "x") == \
        parse_decimal("0.30000000", "x")


# --- deductions and currency ------------------------------------------------------------------ #
def test_deductions_above_the_distribution_raise():
    with pytest.raises(ValueError, match="cannot exceed the gross distribution"):
        run_terms(withholdingPerShare="1.50000000", feesPerShare="1.00000000")


def test_deductions_default_to_zero_when_absent():
    data = payload()
    terms = dict(data["revisions"][0]["terms"])
    del terms["withholdingPerShare"]
    del terms["feesPerShare"]
    data["revisions"][0]["terms"] = terms
    returns = calculate(data)["investorReturnDiagnostics"]
    # With no deductions the net and gross returns coincide.
    assert returns["netCashReturn"] == returns["grossTotalReturn"]


def test_a_same_currency_event_requires_an_identity_fx_rate():
    with pytest.raises(ValueError, match="identity FX rate"):
        run(fxObservation=section(
            "fxObservation", priceCurrencyPerEventCurrency="1.10000000",
        ))


def test_a_cross_currency_event_converts_and_needs_a_matching_pair():
    data = payload()
    data["revisions"][0]["terms"]["eventCurrency"] = "EUR"
    data["fxObservation"] = {**data["fxObservation"],
                             "priceCurrencyPerEventCurrency": "1.10000000",
                             "pair": "EUR/USD"}
    del data["taxIllustration"]              # the illustration is USD-only
    market = calculate(data)["marketDataAdjustment"]
    assert market["grossDistributionInPriceCurrency"] == "2.20000000"


def test_a_mismatched_fx_pair_raises():
    data = payload()
    data["revisions"][0]["terms"]["eventCurrency"] = "EUR"
    data["fxObservation"] = {**data["fxObservation"],
                             "priceCurrencyPerEventCurrency": "1.10000000",
                             "pair": "USD/EUR"}
    del data["taxIllustration"]
    with pytest.raises(ValueError, match="FX pair must be"):
        calculate(data)


def test_an_fx_rate_observed_after_the_reference_raises():
    """It would mix two market states into one number."""

    with pytest.raises(ValueError, match="on or before the reference observation"):
        run(fxObservation=section(
            "fxObservation",
            observedAt="2025-02-01T21:00:00Z", availableAt="2025-02-01T21:00:00Z",
        ))


def test_an_unsupported_fx_anchor_policy_raises():
    with pytest.raises(ValueError, match="unsupported FX anchor policy"):
        run(fxObservation=section("fxObservation", anchorPolicy="LATEST_AVAILABLE"))


# --- the timeline and same-day ordering --------------------------------------------------------- #
def test_a_reference_observed_on_or_after_the_ex_instant_raises():
    """A price observed at the ex instant is already ex, so it is not a reference."""

    with pytest.raises(ValueError, match="must precede exAt"):
        run(referenceObservation=section(
            "referenceObservation",
            observedAt="2025-02-03T14:30:00Z", availableAt="2025-02-03T14:30:05Z",
        ))


def test_an_ex_observation_before_the_ex_instant_raises():
    with pytest.raises(ValueError, match="at or after exAt"):
        run(exObservation=section(
            "exObservation",
            observedAt="2025-02-03T13:00:00Z", availableAt="2025-02-03T13:00:04Z",
        ))


def test_an_observation_not_yet_available_raises():
    with pytest.raises(ValueError, match="observedAt <= availableAt <= asOf"):
        run(referenceObservation=section(
            "referenceObservation", availableAt="2025-02-04T00:00:00Z",
        ))


def test_availability_before_observation_raises():
    with pytest.raises(ValueError, match="observedAt <= availableAt"):
        run(referenceObservation=section(
            "referenceObservation", availableAt="2025-01-31T20:00:00Z",
        ))


def test_a_same_day_sequence_must_name_every_earlier_action():
    """A reference price that does not know what already moved it today is not a reference."""

    with pytest.raises(ValueError, match="every earlier same-day action"):
        run(revisions=[revision(sameDayOrdering={"sequence": 2, "priorEventIds": []})])


def test_a_later_same_day_sequence_with_its_priors_named_is_accepted():
    result = run(revisions=[revision(
        sameDayOrdering={"sequence": 2, "priorEventIds": ["SYN-EARLIER-SPLIT"]},
    )])
    assert result["applied"] is True


@pytest.mark.parametrize("bad", [0, -1, 1.5, "1", True])
def test_a_bad_same_day_sequence_raises(bad):
    with pytest.raises((TypeError, ValueError)):
        run(revisions=[revision(sameDayOrdering={"sequence": bad, "priorEventIds": []})])


def test_a_blank_prior_event_id_raises():
    with pytest.raises(ValueError, match="every earlier same-day action"):
        run(revisions=[revision(
            sameDayOrdering={"sequence": 2, "priorEventIds": [""]},
        )])


# --- point-in-time revision selection ------------------------------------------------------------ #
def test_the_latest_available_revision_wins():
    later = revision(
        revisionId="SYN-ANNOUNCEMENT-R2", revisionSequence=2,
        observedAt="2025-01-25T14:00:00Z", availableAt="2025-01-25T14:02:00Z",
    )
    later["terms"] = {**later["terms"], "grossCapitalReturnPerShare": "2.50000000"}
    result = calculate(payload(revisions=[R1, later]))
    assert result["revisionId"] == "SYN-ANNOUNCEMENT-R2"
    assert result["marketDataAdjustment"]["theoreticalExPrice"] == "22.50000000"


def test_a_revision_published_after_as_of_is_not_used():
    late = revision(
        revisionId="LATE", revisionSequence=2,
        observedAt="2025-02-04T00:00:00Z", availableAt="2025-02-04T00:00:00Z",
    )
    assert calculate(payload(revisions=[R1, late]))["revisionId"] == R1["revisionId"]


def test_no_available_revision_raises():
    with pytest.raises(ValueError, match="no event revision was available"):
        run(asOf="2025-01-01T00:00:00Z")


def test_a_cancelled_revision_returns_a_complete_answer():
    """A withdrawn event is a state, not an error."""

    result = run(revisions=[revision(status="cancelled")])
    assert result["state"] == "cancelled"
    assert result["applied"] is False
    assert "marketDataAdjustment" not in result


def test_a_revision_available_before_it_was_observed_raises():
    with pytest.raises(ValueError, match="observedAt <= availableAt"):
        run(revisions=[revision(availableAt="2025-01-19T00:00:00Z")])


def test_two_event_ids_in_one_call_raise():
    with pytest.raises(ValueError, match="one eventId"):
        run(revisions=[R1, revision(
            eventId="OTHER", revisionId="OTHER-R1", revisionSequence=2,
        )])


def test_a_duplicate_revision_identity_raises():
    with pytest.raises(ValueError, match="duplicate revision identity"):
        run(revisions=[R1, R1])


@pytest.mark.parametrize("bad", ["pending", "", None])
def test_an_unrecognised_status_raises(bad):
    with pytest.raises((TypeError, ValueError)):
        run(revisions=[revision(status=bad)])


def test_select_revision_is_usable_on_its_own():
    chosen = select_revision([R1], parse_instant(INPUT["asOf"], "asOf"))
    assert chosen["revisionId"] == R1["revisionId"]


# --- input hygiene --------------------------------------------------------------------------------- #
def test_a_distribution_that_exhausts_the_price_raises():
    with pytest.raises(ValueError, match="positive theoretical ex-price"):
        run_terms(grossCapitalReturnPerShare="30.00000000")


def test_a_non_object_payload_raises():
    with pytest.raises(TypeError, match="payload must be an object"):
        calculate("nope")


def test_the_input_is_never_mutated():
    import json

    data = payload()
    before = json.dumps(data, sort_keys=True)
    calculate(data)
    assert json.dumps(data, sort_keys=True) == before


def test_a_naive_timestamp_is_refused():
    with pytest.raises(ValueError, match="UTC offset"):
        run(asOf="2025-02-03T21:05:00")


def test_an_impossible_calendar_date_is_refused():
    with pytest.raises(ValueError, match="day outside the month"):
        parse_instant("2025-02-30T00:00:00Z", "t")


def test_a_leap_day_is_accepted_in_a_leap_year_only():
    assert parse_instant("2024-02-29T00:00:00Z", "t") > 0
    with pytest.raises(ValueError, match="day outside the month"):
        parse_instant("2025-02-29T00:00:00Z", "t")


def test_a_century_leap_year_follows_the_four_hundred_year_rule():
    assert parse_instant("2000-02-29T00:00:00Z", "t") > 0
    with pytest.raises(ValueError, match="day outside the month"):
        parse_instant("1900-02-29T00:00:00Z", "t")


def test_the_event_and_revision_ids_travel_into_the_result():
    result = run()
    assert result["eventId"] == "SYN-ROC-2025-001"
    assert result["revisionId"] == "SYN-ANNOUNCEMENT-R1"
    assert result["priceCurrency"] == "USD"
