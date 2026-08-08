"""Keeping the three views apart, and showing what happens when they get blended.

**Do the numbers close?** — :func:`verify_views`
The factor is the price ratio, the forward factor is its reciprocal, the tax legs sum to the
classified amount. All exact, because the module never leaves rational arithmetic.

**What if you adjust by the wrong amount?** — :func:`adjustment_basis_comparison`
The single most common error in this topic: adjusting a price series by the **net** cash a
holder received rather than the **gross** amount that left the company. This prices that
mistake instead of describing it.

**Adjust the history** — :func:`adjust_price_series`
The factor exists to make the series continuous. This applies it, and reports the forward
direction too, because a return of capital is one of the few events where people genuinely
need both.

**How much basis is left?** — :func:`basis_runway`
A return of capital reduces basis until there is none, and then becomes a gain. Running a
sequence of payments against one basis shows exactly when that crossover happens — which is
a tax event nobody schedules for.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from .core import calculate, parse_decimal, render


def _require_applied(result: Any) -> dict[str, Any]:
    if not isinstance(result, dict) or "state" not in result:
        raise ValueError("result must come from calculate()")
    if result["state"] == "cancelled":
        raise ValueError("the selected revision was cancelled; there is nothing to adjust")
    if not result.get("applied") or "marketDataAdjustment" not in result:
        raise ValueError("result must come from calculate()")
    return result


def _value(text: str, name: str) -> Fraction:
    """Read a published decimal string back into the exact rational it came from.

    Published strings may be negative (a return diagnostic), which is why this is separate
    from ``parse_decimal`` — that one guards *inputs*, which must be non-negative.
    """

    if not isinstance(text, str) or not text:
        raise ValueError(f"{name} must be a decimal string")
    return Fraction(text)


def _selected_revision(data: dict[str, Any], revision_id: str) -> dict[str, Any]:
    """The revision the calculation actually used, found by the id it reported."""

    for revision in data.get("revisions", []):
        if isinstance(revision, dict) and revision.get("revisionId") == revision_id:
            return revision
    raise ValueError("data does not contain the revision the result was built from")


def verify_views(result: Any) -> dict[str, Any]:
    """Check the identities that hold inside each view, and the one that spans two.

    * **The theoretical price closes.** ``referencePrice - gross`` equals the theoretical ex
      price, exactly.
    * **The factor is the price ratio**, and the forward factor is its reciprocal — checked
      at the published eight-decimal precision, since both are rounded before you see them.
    * **The tax legs sum to the classified amount.** ``basisReduction + excessOverBasis``
      equals what the issuer classified as return of capital, and the basis never goes
      negative.
    * **Gross total return is at least the net cash return**, which is at least the raw
      price return. Withholding and fees can only reduce what a holder ends up with.

    Everything is exact rational arithmetic on the published strings, so these are true
    equalities rather than tolerance comparisons.
    """

    diagnosis = _require_applied(result)
    market = diagnosis["marketDataAdjustment"]
    reference = _value(market["referencePrice"], "referencePrice")
    gross = _value(market["grossDistributionInPriceCurrency"], "gross")
    theoretical = _value(market["theoreticalExPrice"], "theoreticalExPrice")
    backward = _value(market["backwardHistoryFactor"], "backwardHistoryFactor")
    forward = _value(market["forwardPostEventFactor"], "forwardPostEventFactor")

    tolerance = Fraction(1, 10 ** 8)
    price_closes = reference - gross == theoretical
    factor_matches = abs(backward - theoretical / reference) <= tolerance
    # Rounded independently, so the round trip is checked at the published precision.
    factors_reciprocal = (
        backward != 0 and abs(backward * forward - 1) <= tolerance * 2
    )

    returns = diagnosis.get("investorReturnDiagnostics")
    return_breaks: list[dict[str, Any]] = []
    if returns is not None:
        raw = _value(returns["rawPriceReturn"], "rawPriceReturn")
        gross_return = _value(returns["grossTotalReturn"], "grossTotalReturn")
        net_return = _value(returns["netCashReturn"], "netCashReturn")
        if gross_return < net_return:
            return_breaks.append({"check": "grossTotalReturn >= netCashReturn"})
        if net_return < raw:
            return_breaks.append({"check": "netCashReturn >= rawPriceReturn"})

    tax = diagnosis.get("usFederalTaxIllustration")
    tax_breaks: list[dict[str, Any]] = []
    if tax is not None:
        after = _value(tax["basisPerShareAfter"], "basisPerShareAfter")
        reduction = _value(tax["basisReductionPerShare"], "basisReductionPerShare")
        excess = _value(tax["excessOverBasisPerShare"], "excessOverBasisPerShare")
        if after < 0:
            tax_breaks.append({"check": "basisPerShareAfter >= 0"})
        # You cannot both have basis left and have exceeded it.
        if after > 0 and excess > 0:
            tax_breaks.append({"check": "basis remaining and excess are mutually exclusive"})
        if reduction < 0 or excess < 0:
            tax_breaks.append({"check": "tax legs are non-negative"})

    return {
        "priceCloses": price_closes,
        "factorMatchesPriceRatio": factor_matches,
        "factorsAreReciprocal": factors_reciprocal,
        "returnsChecked": returns is not None,
        "returnBreaks": return_breaks,
        "taxChecked": tax is not None,
        "taxBreaks": tax_breaks,
        # A theoretical price is not a trade, and the result says so.
        "theoreticalPriceIsObservedTrade": market["theoreticalPriceIsObservedTrade"],
        "ok": (
            price_closes and factor_matches and factors_reciprocal
            and not return_breaks and not tax_breaks
        ),
    }


def adjustment_basis_comparison(data: dict[str, Any]) -> dict[str, Any]:
    """Price the classic error: adjusting by the net cash instead of the gross distribution.

    The market-data adjustment uses the **gross** amount because that is what left the
    company. The net amount is what a *particular holder* received after withholding and
    fees, and it varies by holder — so using it produces a price series that is specific to
    one investor's tax position and wrong for everybody else, including them next year.

    This runs both and reports the gap. The correct figure is always the gross one; the net
    one is shown so the size of the mistake is a number rather than a warning.
    """

    if not isinstance(data, dict):
        raise TypeError("data must be an object")
    correct = calculate(data)
    market = correct["marketDataAdjustment"]

    reference = _value(market["referencePrice"], "referencePrice")
    gross = _value(market["grossDistributionInPriceCurrency"], "gross")

    # Rebuild the net-of-cash distribution from the same terms and FX the calculation used.
    revision = _selected_revision(data, correct["revisionId"])
    terms = revision["terms"]
    withholding = parse_decimal(
        terms["withholdingPerShare"] if "withholdingPerShare" in terms else "0",
        "withholdingPerShare",
    )
    fees = parse_decimal(
        terms["feesPerShare"] if "feesPerShare" in terms else "0", "feesPerShare",
    )
    fx = parse_decimal(
        data["fxObservation"]["priceCurrencyPerEventCurrency"], "fx", positive=True,
    )
    deductions = (withholding + fees) * fx
    net_distribution = gross - deductions

    wrong_theoretical = reference - net_distribution
    wrong_factor = wrong_theoretical / reference if reference else Fraction(0)
    correct_theoretical = _value(market["theoreticalExPrice"], "theoreticalExPrice")

    return {
        "referencePrice": market["referencePrice"],
        "grossDistribution": market["grossDistributionInPriceCurrency"],
        "netDistribution": render(net_distribution),
        "correctTheoreticalExPrice": market["theoreticalExPrice"],
        "wrongTheoreticalExPrice": render(wrong_theoretical),
        "correctBackwardFactor": market["backwardHistoryFactor"],
        "wrongBackwardFactor": render(wrong_factor),
        # What the mistake costs, per share and as a fraction of the price.
        "priceOverstatedBy": render(wrong_theoretical - correct_theoretical),
        "relativeError": render(
            (wrong_theoretical - correct_theoretical) / correct_theoretical
        ) if correct_theoretical else None,
        "deductionsPerShare": render(deductions),
        "identical": deductions == 0,
        "correctBasis": "gross",
    }


def adjust_price_series(result: Any, prices: list[str]) -> dict[str, Any]:
    """Apply the factor to a price history, backward or forward.

    ``backward`` restates pre-ex prices onto the post-event basis, which is what a
    continuous return series needs. ``forward`` does the opposite: it carries post-event
    prices back onto the pre-event basis, which is what a cost basis or a filed figure
    needs. A return of capital is one of the few events where people genuinely want both,
    so both factors are published and this applies either.

    Prices are decimal strings in and out, like everything else here.
    """

    diagnosis = _require_applied(result)
    if not isinstance(prices, list) or not prices:
        raise TypeError("prices must be a non-empty list")
    market = diagnosis["marketDataAdjustment"]
    backward = _value(market["backwardHistoryFactor"], "backwardHistoryFactor")
    forward = _value(market["forwardPostEventFactor"], "forwardPostEventFactor")

    rows: list[dict[str, str]] = []
    for index, price in enumerate(prices):
        value = parse_decimal(price, f"prices[{index}]", positive=True)
        rows.append({
            "rawPrice": render(value),
            "backwardAdjusted": render(value * backward),
            "forwardAdjusted": render(value * forward),
        })

    return {
        "factorDirection": market["factorDirection"],
        "backwardHistoryFactor": market["backwardHistoryFactor"],
        "forwardPostEventFactor": market["forwardPostEventFactor"],
        "rows": rows,
        "rawExDateStep": render(backward - 1),
        "adjustedExDateStep": render(Fraction(0)),
    }


def basis_runway(
    basis_before: str, classified_amounts: list[str]
) -> dict[str, Any]:
    """Run a sequence of return-of-capital payments against one cost basis.

    Basis falls until it reaches zero, and everything after that is a **gain** rather than a
    further reduction. That crossover is a taxable event nobody puts in a calendar, and it
    arrives on whichever payment happens to cross it.

    Deliberately independent of :func:`calculate`: the amounts here are what the issuer
    *classified* as return of capital, which is not the same as what it distributed, and
    stringing several events together is exactly where the distinction bites.
    """

    if not isinstance(classified_amounts, list) or not classified_amounts:
        raise TypeError("classified_amounts must be a non-empty list")

    basis = parse_decimal(basis_before, "basis_before")
    rows: list[dict[str, str]] = []
    total_reduction = Fraction(0)
    total_excess = Fraction(0)
    exhausted_at: int | None = None

    for index, amount in enumerate(classified_amounts):
        classified = parse_decimal(amount, f"classified_amounts[{index}]")
        reduction = min(basis, classified)
        excess = classified - reduction
        basis -= reduction
        total_reduction += reduction
        total_excess += excess
        if basis == 0 and exhausted_at is None:
            exhausted_at = index
        rows.append({
            "classifiedAmount": render(classified),
            "basisReduction": render(reduction),
            "excessOverBasis": render(excess),
            "basisAfter": render(basis),
        })

    return {
        "basisBefore": render(parse_decimal(basis_before, "basis_before")),
        "rows": rows,
        "basisAfter": render(basis),
        "totalBasisReduction": render(total_reduction),
        # Everything past the crossover is a gain, not a reduction.
        "totalExcessOverBasis": render(total_excess),
        "basisExhausted": basis == 0,
        "exhaustedAtIndex": exhausted_at,
        "paymentsBeforeExhaustion": exhausted_at,
    }
