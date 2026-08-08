"""Return of capital: a payment that is not income, and three views that must stay apart.

A return of capital hands cash back to shareholders out of **capital rather than earnings**.
The price falls like any distribution, but the tax treatment is entirely different: it
reduces your cost basis rather than being taxed as income, and only the part that exceeds
your basis becomes a gain.

That is why this module keeps **three views separate on purpose** and never blends them:

* **The market-data adjustment.** Reference price less the gross distribution gives a
  theoretical ex price and a backward factor. This is the number a price series needs, and
  it uses the **gross** amount because that is what left the company — regardless of what
  any individual holder received.
* **Investor return diagnostics.** Raw price return, gross total return, and net-of-cash
  return. Three different answers to "how did I do", all defensible, none of them the
  adjustment factor.
* **A US federal tax illustration.** Basis reduction, and any excess over basis. Explicitly
  scoped to one jurisdiction and one year, requiring USD, and clearly an *illustration*.

Blending them is the classic error: adjusting a price series by the net-of-withholding
amount, or treating the whole distribution as a basis reduction when the issuer only
classified part of it as return of capital.

**Every monetary value is a plain decimal string**, in and out. No floats cross the
interface in either direction, and the arithmetic is exact rational internally with a single
half-up rounding to eight decimals at the end.

Article: https://thefintechbuilder.com/corporate-actions-and-security-master-data/complex-distributions/return-of-capital-adjustment/
"""

from __future__ import annotations

import re
from copy import deepcopy
from fractions import Fraction
from typing import Any

#: Output precision. Eight decimals, half away from zero, applied once.
OUTPUT_DECIMALS = 8

#: The one tax scope the illustration supports.
US_TAX_SCOPE = "US_FEDERAL_INDIVIDUAL_TAXABLE_2025"

#: The one FX anchor policy this implementation supports.
FX_ANCHOR_POLICY = "ON_OR_BEFORE_REFERENCE_OBSERVATION"

STATUSES = ("confirmed", "cancelled")

_DECIMAL = re.compile(r"^\d+(?:\.\d+)?$")
_INSTANT = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?"
    r"(Z|[+-]\d{2}:\d{2})$"
)
_MONTH_LENGTHS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TypeError(f"{name} must be a non-empty string")
    return value


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def parse_instant(value: Any, name: str) -> float:
    """An ISO 8601 instant with an explicit UTC offset, as epoch seconds.

    A naive timestamp is refused rather than assumed to be UTC. Every timestamp here is an
    availability boundary, and the calendar is checked against real month lengths because
    ``2025-02-30`` is a date some parsers quietly move into March.
    """

    text = _text(value, name)
    match = _INSTANT.match(text)
    if match is None:
        raise ValueError(f"{name} must be a valid ISO 8601 instant with a UTC offset")
    year, month, day, hour, minute = (int(part) for part in match.groups()[:5])
    second = int(match.group(6) or 0)
    fraction = match.group(7) or ""
    offset = match.group(8)

    if not 1 <= month <= 12:
        raise ValueError(f"{name} has a month outside 1-12")
    length = _MONTH_LENGTHS[month - 1] + (1 if month == 2 and _is_leap(year) else 0)
    if not 1 <= day <= length:
        raise ValueError(f"{name} has a day outside the month")
    if hour > 23 or minute > 59 or second > 59:
        raise ValueError(f"{name} has a time outside 00:00:00-23:59:59")

    shifted = year - (month <= 2)
    era = (shifted if shifted >= 0 else shifted - 399) // 400
    year_of_era = shifted - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    days = era * 146097 + day_of_era - 719468

    seconds = days * 86400 + hour * 3600 + minute * 60 + second
    if fraction:
        seconds += int(fraction) / 10 ** len(fraction)
    if offset != "Z":
        sign = 1 if offset[0] == "+" else -1
        offset_hours, offset_minutes = int(offset[1:3]), int(offset[4:6])
        if offset_hours > 23 or offset_minutes > 59:
            raise ValueError(f"{name} has an offset outside ±23:59")
        seconds -= sign * (offset_hours * 3600 + offset_minutes * 60)
    return seconds


def parse_decimal(value: Any, name: str, *, positive: bool = False) -> Fraction:
    """A plain decimal string as an exact rational.

    Strings rather than JSON numbers on purpose: a monetary amount that survives a round
    trip through a double is a different amount, and the whole point of this module is that
    three separately-reported views agree to the cent.

    Exponent notation is refused because it is not a *plain* decimal, and at most eight
    decimal places are accepted because that is the published precision — silently
    truncating a ninth would be worse than saying so.
    """

    if not isinstance(value, str) or not value:
        raise TypeError(f"{name} must be a plain decimal string")
    if "e" in value.lower():
        raise TypeError(f"{name} must be a plain decimal string")
    if _DECIMAL.match(value) is None:
        raise ValueError(f"{name} must be a valid non-negative decimal string")
    if "." in value and len(value.split(".")[1]) > OUTPUT_DECIMALS:
        raise ValueError(f"{name} supports at most {OUTPUT_DECIMALS} decimal places")
    result = Fraction(value)
    if positive and result == 0:
        raise ValueError(f"{name} must be positive")
    return result


def render(value: Fraction) -> str:
    """Render an exact rational as a fixed eight-decimal string, half away from zero.

    The arithmetic stays rational all the way through and rounds **once**, here. Both
    languages do the same, which is why every published string matches to the last digit.
    """

    scale = 10 ** OUTPUT_DECIMALS
    numerator = abs(value.numerator) * scale
    whole, remainder = divmod(numerator, value.denominator)
    if remainder * 2 >= value.denominator:
        whole += 1
    sign = "-" if value.numerator < 0 and whole != 0 else ""
    digits = str(whole).rjust(OUTPUT_DECIMALS + 1, "0")
    return f"{sign}{digits[:-OUTPUT_DECIMALS]}.{digits[-OUTPUT_DECIMALS:]}"


def _get(source: dict[str, Any], key: str, fallback: Any) -> Any:
    """``dict.get`` semantics: the default applies when the key is absent, not when null."""

    return source[key] if key in source else fallback


def select_revision(revisions: Any, as_of: float) -> dict[str, Any]:
    """The latest revision that had actually been published by ``as_of``."""

    if not isinstance(revisions, list) or not revisions:
        raise TypeError("revisions must be a non-empty list")

    candidates: list[tuple[float, int, dict[str, Any]]] = []
    seen: set[tuple[str, int]] = set()
    event_id: str | None = None

    for revision in revisions:
        if not isinstance(revision, dict):
            raise TypeError("each revision must be an object")
        current_event = _text(revision.get("eventId"), "eventId")
        if event_id is None:
            event_id = current_event
        elif current_event != event_id:
            raise ValueError("all revisions must describe one eventId")

        sequence = revision.get("revisionSequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise ValueError("revisionSequence must be a positive integer")
        identity = (_text(revision.get("revisionId"), "revisionId"), sequence)
        if identity in seen:
            raise ValueError("duplicate revision identity")
        seen.add(identity)

        observed = parse_instant(revision.get("observedAt"), "observedAt")
        available = parse_instant(revision.get("availableAt"), "availableAt")
        _text(revision.get("sourceId"), "sourceId")
        if observed > available:
            raise ValueError("event revision must satisfy observedAt <= availableAt")
        if available <= as_of:
            candidates.append((available, sequence, revision))

    if not candidates:
        raise ValueError("no event revision was available at asOf")
    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates[-1][2]


def _observation(value: Any, name: str, as_of: float) -> tuple[Fraction, str]:
    """A priced observation with its provenance, checked against the knowledge time."""

    if not isinstance(value, dict):
        raise TypeError(f"{name} must be an object")
    observed = parse_instant(value.get("observedAt"), f"{name}.observedAt")
    available = parse_instant(value.get("availableAt"), f"{name}.availableAt")
    if observed > available or available > as_of:
        raise ValueError(f"{name} must satisfy observedAt <= availableAt <= asOf")
    _text(value.get("sourceId"), f"{name}.sourceId")
    return (
        parse_decimal(value.get("price"), f"{name}.price", positive=True),
        _text(value.get("currency"), f"{name}.currency"),
    )


def calculate(payload: dict[str, Any]) -> dict[str, Any]:
    """Calculate an auditable adjustment from the latest knowable revision."""

    if not isinstance(payload, dict):
        raise TypeError("payload must be an object")
    data = deepcopy(payload)
    as_of = parse_instant(data.get("asOf"), "asOf")
    revision = select_revision(data.get("revisions"), as_of)

    status = _text(revision.get("status"), "status")
    if status not in STATUSES:
        raise ValueError("status must be confirmed or cancelled")
    if status == "cancelled":
        # A withdrawn event is a complete answer, not an error.
        return {
            "eventId": revision["eventId"],
            "revisionId": revision["revisionId"],
            "state": "cancelled",
            "applied": False,
        }

    ex_at = parse_instant(revision.get("exAt"), "exAt")
    if parse_instant(revision.get("availableAt"), "availableAt") > as_of:
        raise ValueError("selected revision is not available")

    terms = revision.get("terms")
    if not isinstance(terms, dict):
        raise TypeError("terms must be an object")
    event_currency = _text(terms.get("eventCurrency"), "eventCurrency")
    gross_event = parse_decimal(
        terms.get("grossCapitalReturnPerShare"), "grossCapitalReturnPerShare"
    )
    withholding_event = parse_decimal(
        _get(terms, "withholdingPerShare", "0"), "withholdingPerShare"
    )
    fees_event = parse_decimal(_get(terms, "feesPerShare", "0"), "feesPerShare")
    # Deductions cannot exceed the payment they are deducted from.
    if withholding_event + fees_event > gross_event:
        raise ValueError("withholding plus fees cannot exceed the gross distribution")

    reference, price_currency = _observation(
        data.get("referenceObservation"), "referenceObservation", as_of
    )
    reference_observed = parse_instant(
        data["referenceObservation"]["observedAt"], "referenceObservation.observedAt"
    )
    # A price observed on or after the ex date is already ex, so it is not a reference.
    if reference_observed >= ex_at:
        raise ValueError("referenceObservation must precede exAt")

    fx = data.get("fxObservation")
    if not isinstance(fx, dict):
        raise TypeError("fxObservation must be an object")
    fx_rate = parse_decimal(
        fx.get("priceCurrencyPerEventCurrency"), "priceCurrencyPerEventCurrency", positive=True
    )
    if _text(fx.get("anchorPolicy"), "fxObservation.anchorPolicy") != FX_ANCHOR_POLICY:
        raise ValueError("unsupported FX anchor policy")
    fx_observed = parse_instant(fx.get("observedAt"), "fxObservation.observedAt")
    fx_available = parse_instant(fx.get("availableAt"), "fxObservation.availableAt")
    if fx_observed > fx_available or fx_available > as_of:
        raise ValueError("FX must satisfy observedAt <= availableAt <= asOf")
    # A rate observed after the price would mix two market states into one number.
    if fx_observed > reference_observed:
        raise ValueError("FX observation must be on or before the reference observation")
    _text(fx.get("sourceId"), "fxObservation.sourceId")
    if event_currency == price_currency and fx_rate != 1:
        raise ValueError("same-currency events require an identity FX rate of 1")
    if event_currency != price_currency and _text(
        fx.get("pair"), "fxObservation.pair"
    ) != f"{event_currency}/{price_currency}":
        raise ValueError("FX pair must be eventCurrency/priceCurrency")

    ordering = revision.get("sameDayOrdering")
    if not isinstance(ordering, dict):
        raise TypeError("sameDayOrdering must be an object")
    sequence = ordering.get("sequence")
    prior = ordering.get("priorEventIds")
    if (
        isinstance(sequence, bool) or not isinstance(sequence, int)
        or sequence < 1 or not isinstance(prior, list)
    ):
        raise ValueError("sameDayOrdering requires a positive sequence and priorEventIds")
    # The reference price has to know about every action that already moved it today.
    if len(prior) != sequence - 1 or any(
        not isinstance(item, str) or not item for item in prior
    ):
        raise ValueError("reference price must identify every earlier same-day action")

    gross_price = gross_event * fx_rate
    net_price = (gross_event - withholding_event - fees_event) * fx_rate
    theoretical_ex = reference - gross_price
    if theoretical_ex <= 0:
        raise ValueError("gross distribution must leave a positive theoretical ex-price")
    factor = theoretical_ex / reference

    returns: dict[str, str] | None = None
    if _get(data, "exObservation", None) is not None:
        observed_ex, ex_currency = _observation(data["exObservation"], "exObservation", as_of)
        if ex_currency != price_currency:
            raise ValueError("exObservation currency must equal price currency")
        if parse_instant(
            data["exObservation"]["observedAt"], "exObservation.observedAt"
        ) < ex_at:
            raise ValueError("exObservation must be at or after exAt")
        # Three defensible answers to "how did I do", and none of them is the factor.
        returns = {
            "rawPriceReturn": render(observed_ex / reference - 1),
            "grossTotalReturn": render((observed_ex + gross_price) / reference - 1),
            "netCashReturn": render((observed_ex + net_price) / reference - 1),
        }

    tax_result: dict[str, str] | None = None
    tax = _get(data, "taxIllustration", None)
    if tax is not None:
        if not isinstance(tax, dict) or _text(
            tax.get("jurisdiction"), "taxIllustration.jurisdiction"
        ) != US_TAX_SCOPE:
            raise ValueError(f"tax illustration supports only {US_TAX_SCOPE}")
        if event_currency != "USD" or _text(
            tax.get("currency"), "taxIllustration.currency"
        ) != "USD":
            raise ValueError("US tax illustration requires USD event and basis amounts")
        _text(tax.get("sourceId"), "taxIllustration.sourceId")
        tax_observed = parse_instant(tax.get("observedAt"), "taxIllustration.observedAt")
        tax_available = parse_instant(tax.get("availableAt"), "taxIllustration.availableAt")
        if tax_observed > tax_available or tax_available > as_of:
            raise ValueError("tax illustration must satisfy observedAt <= availableAt <= asOf")
        basis = parse_decimal(tax.get("basisPerShareBefore"), "basisPerShareBefore")
        classified = parse_decimal(
            tax.get("confirmedReturnOfCapitalPerShare"), "confirmedReturnOfCapitalPerShare"
        )
        # The issuer classifies part of a payment as return of capital, never more than all.
        if classified > gross_event:
            raise ValueError(
                "tax-classified return of capital cannot exceed the gross distribution"
            )
        # Basis floors at zero; anything past it is a gain, not a further reduction.
        reduction = min(basis, classified)
        tax_result = {
            "basisPerShareAfter": render(basis - reduction),
            "basisReductionPerShare": render(reduction),
            "excessOverBasisPerShare": render(classified - reduction),
        }

    return {
        "eventId": revision["eventId"],
        "revisionId": revision["revisionId"],
        "state": "confirmed",
        "applied": True,
        "priceCurrency": price_currency,
        "marketDataAdjustment": {
            "referencePrice": render(reference),
            # GROSS, because that is what left the company — not what any holder received.
            "grossDistributionInPriceCurrency": render(gross_price),
            "theoreticalExPrice": render(theoretical_ex),
            "backwardHistoryFactor": render(factor),
            "forwardPostEventFactor": render(1 / factor),
            "factorDirection": "multiply_pre_ex_history_by_backwardHistoryFactor",
            # A theoretical price, not a trade that happened.
            "theoreticalPriceIsObservedTrade": False,
        },
        "investorReturnDiagnostics": returns,
        "usFederalTaxIllustration": tax_result,
    }
