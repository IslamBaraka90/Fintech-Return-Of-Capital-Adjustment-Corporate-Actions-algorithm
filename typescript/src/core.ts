/**
 * Return of capital: a payment that is not income, and three views that must stay apart.
 *
 * A return of capital hands cash back to shareholders out of **capital rather than
 * earnings**. The price falls like any distribution, but the tax treatment is entirely
 * different: it reduces your cost basis rather than being taxed as income, and only the part
 * that exceeds your basis becomes a gain.
 *
 * That is why this module keeps **three views separate on purpose** and never blends them:
 *
 * - **The market-data adjustment.** Reference price less the gross distribution gives a
 *   theoretical ex price and a backward factor. It uses the **gross** amount because that is
 *   what left the company — regardless of what any individual holder received.
 * - **Investor return diagnostics.** Raw price return, gross total return, and
 *   net-of-cash return. Three defensible answers to "how did I do", none of them the factor.
 * - **A US federal tax illustration.** Basis reduction, and any excess over basis. Scoped to
 *   one jurisdiction and one year, requiring USD, and clearly an *illustration*.
 *
 * **Every monetary value is a plain decimal string**, in and out. No floats cross the
 * interface in either direction, and the arithmetic is exact rational internally with a
 * single half-up rounding to eight decimals at the end.
 *
 * Article: https://thefintechbuilder.com/corporate-actions-and-security-master-data/complex-distributions/return-of-capital-adjustment/
 */

import { ONE, Rational, ZERO } from "./rational.ts";

/** Output precision. Eight decimals, half away from zero, applied once. */
export const OUTPUT_DECIMALS = 8;

/** The one tax scope the illustration supports. */
export const US_TAX_SCOPE = "US_FEDERAL_INDIVIDUAL_TAXABLE_2025";

/** The one FX anchor policy this implementation supports. */
export const FX_ANCHOR_POLICY = "ON_OR_BEFORE_REFERENCE_OBSERVATION";

export const STATUSES = ["confirmed", "cancelled"] as const;

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface MarketDataAdjustment {
  referencePrice: string;
  grossDistributionInPriceCurrency: string;
  theoreticalExPrice: string;
  backwardHistoryFactor: string;
  forwardPostEventFactor: string;
  factorDirection: string;
  theoreticalPriceIsObservedTrade: boolean;
}

export interface ReturnDiagnostics {
  rawPriceReturn: string;
  grossTotalReturn: string;
  netCashReturn: string;
}

export interface TaxIllustration {
  basisPerShareAfter: string;
  basisReductionPerShare: string;
  excessOverBasisPerShare: string;
}

export interface ReturnOfCapitalResult {
  eventId: string;
  revisionId: string;
  state: string;
  applied: boolean;
  priceCurrency?: string;
  marketDataAdjustment?: MarketDataAdjustment;
  investorReturnDiagnostics?: ReturnDiagnostics | null;
  usFederalTaxIllustration?: TaxIllustration | null;
}

function textValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

const isLeap = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/**
 * An ISO 8601 instant with an explicit UTC offset, as epoch seconds.
 *
 * A naive timestamp is refused rather than assumed to be UTC. Every timestamp here is an
 * availability boundary, and the calendar is checked against real month lengths because
 * `2025-02-30` is a date some parsers quietly move into March.
 */
export function parseInstant(value: unknown, name: string): number {
  const text = textValue(value, name);
  const match = INSTANT_PATTERN.exec(text);
  if (match === null) {
    throw new RangeError(`${name} must be a valid ISO 8601 instant with a UTC offset`);
  }
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as number[];
  const second = Number(match[6] ?? 0);
  const fraction = match[7] ?? "";
  const offset = match[8]!;

  if (month! < 1 || month! > 12) throw new RangeError(`${name} has a month outside 1-12`);
  const length = MONTH_LENGTHS[month! - 1]! + (month === 2 && isLeap(year!) ? 1 : 0);
  if (day! < 1 || day! > length) throw new RangeError(`${name} has a day outside the month`);
  if (hour! > 23 || minute! > 59 || second > 59) {
    throw new RangeError(`${name} has a time outside 00:00:00-23:59:59`);
  }

  const shifted = year! - (month! <= 2 ? 1 : 0);
  const era = Math.floor((shifted >= 0 ? shifted : shifted - 399) / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month! + (month! > 2 ? -3 : 9)) + 2) / 5) + day! - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const days = era * 146097 + dayOfEra - 719468;

  let seconds = days * 86400 + hour! * 3600 + minute! * 60 + second;
  if (fraction) seconds += Number(fraction) / 10 ** fraction.length;
  if (offset !== "Z") {
    const sign = offset[0] === "+" ? 1 : -1;
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      throw new RangeError(`${name} has an offset outside ±23:59`);
    }
    seconds -= sign * (offsetHours * 3600 + offsetMinutes * 60);
  }
  return seconds;
}

/**
 * A plain decimal string as an exact rational.
 *
 * Strings rather than JSON numbers on purpose: a monetary amount that survives a round trip
 * through a double is a different amount, and the whole point of this module is that three
 * separately-reported views agree to the cent.
 *
 * Exponent notation is refused because it is not a *plain* decimal, and at most eight decimal
 * places are accepted because that is the published precision — silently truncating a ninth
 * would be worse than saying so.
 */
export function parseDecimal(
  value: unknown,
  name: string,
  options: { positive?: boolean } = {},
): Rational {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`${name} must be a plain decimal string`);
  }
  if (value.toLowerCase().includes("e")) {
    throw new TypeError(`${name} must be a plain decimal string`);
  }
  if (!DECIMAL_PATTERN.test(value)) {
    throw new RangeError(`${name} must be a valid non-negative decimal string`);
  }
  if (value.includes(".") && value.split(".")[1]!.length > OUTPUT_DECIMALS) {
    throw new RangeError(`${name} supports at most ${OUTPUT_DECIMALS} decimal places`);
  }
  const result = Rational.fromDecimalString(value);
  if (options.positive && result.sign === 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return result;
}

/**
 * Render an exact rational as a fixed eight-decimal string, half away from zero.
 *
 * The arithmetic stays rational all the way through and rounds **once**, here. Both languages
 * do the same, which is why every published string matches to the last digit.
 */
export function render(value: Rational): string {
  const scale = 10n ** BigInt(OUTPUT_DECIMALS);
  const numerator = (value.numerator < 0n ? -value.numerator : value.numerator) * scale;
  let whole = numerator / value.denominator;
  if ((numerator % value.denominator) * 2n >= value.denominator) whole += 1n;
  const sign = value.numerator < 0n && whole !== 0n ? "-" : "";
  const digits = whole.toString().padStart(OUTPUT_DECIMALS + 1, "0");
  return `${sign}${digits.slice(0, -OUTPUT_DECIMALS)}.${digits.slice(-OUTPUT_DECIMALS)}`;
}

/** `dict.get` semantics: the default applies when the key is absent, not when it is null. */
function get(source: Record<string, any>, key: string, fallback: unknown): unknown {
  return key in source ? source[key] : fallback;
}

/** The latest revision that had actually been published by `asOf`. */
export function selectRevision(revisions: unknown, asOf: number): Record<string, any> {
  if (!Array.isArray(revisions) || revisions.length === 0) {
    throw new TypeError("revisions must be a non-empty list");
  }

  const candidates: Array<[number, number, Record<string, any>]> = [];
  const seen = new Set<string>();
  let eventId: string | null = null;

  for (const raw of revisions) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError("each revision must be an object");
    }
    const revision = raw as Record<string, any>;
    const currentEvent = textValue(revision.eventId, "eventId");
    if (eventId === null) eventId = currentEvent;
    else if (currentEvent !== eventId) {
      throw new RangeError("all revisions must describe one eventId");
    }

    const sequence = revision.revisionSequence;
    if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
      throw new RangeError("revisionSequence must be a positive integer");
    }
    const identity = `${textValue(revision.revisionId, "revisionId")} ${sequence}`;
    if (seen.has(identity)) throw new RangeError("duplicate revision identity");
    seen.add(identity);

    const observed = parseInstant(revision.observedAt, "observedAt");
    const available = parseInstant(revision.availableAt, "availableAt");
    textValue(revision.sourceId, "sourceId");
    if (observed > available) {
      throw new RangeError("event revision must satisfy observedAt <= availableAt");
    }
    if (available <= asOf) candidates.push([available, sequence, revision]);
  }

  if (candidates.length === 0) {
    throw new RangeError("no event revision was available at asOf");
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return candidates[candidates.length - 1]![2];
}

/** A priced observation with its provenance, checked against the knowledge time. */
function observation(value: unknown, name: string, asOf: number): [Rational, string] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const row = value as Record<string, any>;
  const observed = parseInstant(row.observedAt, `${name}.observedAt`);
  const available = parseInstant(row.availableAt, `${name}.availableAt`);
  if (observed > available || available > asOf) {
    throw new RangeError(`${name} must satisfy observedAt <= availableAt <= asOf`);
  }
  textValue(row.sourceId, `${name}.sourceId`);
  return [
    parseDecimal(row.price, `${name}.price`, { positive: true }),
    textValue(row.currency, `${name}.currency`),
  ];
}

/** Calculate an auditable adjustment from the latest knowable revision. */
export function calculate(payload: unknown): ReturnOfCapitalResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("payload must be an object");
  }
  const data = JSON.parse(JSON.stringify(payload)) as Record<string, any>;
  const asOf = parseInstant(data.asOf, "asOf");
  const revision = selectRevision(data.revisions, asOf);

  const status = textValue(revision.status, "status");
  if (!STATUSES.includes(status as never)) {
    throw new RangeError("status must be confirmed or cancelled");
  }
  if (status === "cancelled") {
    // A withdrawn event is a complete answer, not an error.
    return {
      eventId: revision.eventId,
      revisionId: revision.revisionId,
      state: "cancelled",
      applied: false,
    };
  }

  const exAt = parseInstant(revision.exAt, "exAt");
  if (parseInstant(revision.availableAt, "availableAt") > asOf) {
    throw new RangeError("selected revision is not available");
  }

  const terms = revision.terms;
  if (terms === null || typeof terms !== "object" || Array.isArray(terms)) {
    throw new TypeError("terms must be an object");
  }
  const eventCurrency = textValue(terms.eventCurrency, "eventCurrency");
  const grossEvent = parseDecimal(
    terms.grossCapitalReturnPerShare, "grossCapitalReturnPerShare",
  );
  const withholdingEvent = parseDecimal(
    get(terms, "withholdingPerShare", "0"), "withholdingPerShare",
  );
  const feesEvent = parseDecimal(get(terms, "feesPerShare", "0"), "feesPerShare");
  // Deductions cannot exceed the payment they are deducted from.
  if (withholdingEvent.add(feesEvent).compare(grossEvent) > 0) {
    throw new RangeError("withholding plus fees cannot exceed the gross distribution");
  }

  const [reference, priceCurrency] = observation(
    data.referenceObservation, "referenceObservation", asOf,
  );
  const referenceObserved = parseInstant(
    data.referenceObservation.observedAt, "referenceObservation.observedAt",
  );
  // A price observed on or after the ex date is already ex, so it is not a reference.
  if (referenceObserved >= exAt) {
    throw new RangeError("referenceObservation must precede exAt");
  }

  const fx = data.fxObservation;
  if (fx === null || typeof fx !== "object" || Array.isArray(fx)) {
    throw new TypeError("fxObservation must be an object");
  }
  const fxRate = parseDecimal(
    fx.priceCurrencyPerEventCurrency, "priceCurrencyPerEventCurrency", { positive: true },
  );
  if (textValue(fx.anchorPolicy, "fxObservation.anchorPolicy") !== FX_ANCHOR_POLICY) {
    throw new RangeError("unsupported FX anchor policy");
  }
  const fxObserved = parseInstant(fx.observedAt, "fxObservation.observedAt");
  const fxAvailable = parseInstant(fx.availableAt, "fxObservation.availableAt");
  if (fxObserved > fxAvailable || fxAvailable > asOf) {
    throw new RangeError("FX must satisfy observedAt <= availableAt <= asOf");
  }
  // A rate observed after the price would mix two market states into one number.
  if (fxObserved > referenceObserved) {
    throw new RangeError("FX observation must be on or before the reference observation");
  }
  textValue(fx.sourceId, "fxObservation.sourceId");
  if (eventCurrency === priceCurrency && !fxRate.equals(ONE)) {
    throw new RangeError("same-currency events require an identity FX rate of 1");
  }
  if (
    eventCurrency !== priceCurrency &&
    textValue(fx.pair, "fxObservation.pair") !== `${eventCurrency}/${priceCurrency}`
  ) {
    throw new RangeError("FX pair must be eventCurrency/priceCurrency");
  }

  const ordering = revision.sameDayOrdering;
  if (ordering === null || typeof ordering !== "object" || Array.isArray(ordering)) {
    throw new TypeError("sameDayOrdering must be an object");
  }
  const sequence = ordering.sequence;
  const prior = ordering.priorEventIds;
  if (
    typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1 ||
    !Array.isArray(prior)
  ) {
    throw new RangeError("sameDayOrdering requires a positive sequence and priorEventIds");
  }
  // The reference price has to know about every action that already moved it today.
  if (
    prior.length !== sequence - 1 ||
    prior.some((item) => typeof item !== "string" || item === "")
  ) {
    throw new RangeError("reference price must identify every earlier same-day action");
  }

  const grossPrice = grossEvent.multiply(fxRate);
  const netPrice = grossEvent.subtract(withholdingEvent).subtract(feesEvent).multiply(fxRate);
  const theoreticalEx = reference.subtract(grossPrice);
  if (theoreticalEx.sign <= 0) {
    throw new RangeError("gross distribution must leave a positive theoretical ex-price");
  }
  const factor = theoreticalEx.divide(reference);

  let returns: ReturnDiagnostics | null = null;
  if (get(data, "exObservation", null) !== null) {
    const [observedEx, exCurrency] = observation(data.exObservation, "exObservation", asOf);
    if (exCurrency !== priceCurrency) {
      throw new RangeError("exObservation currency must equal price currency");
    }
    if (parseInstant(data.exObservation.observedAt, "exObservation.observedAt") < exAt) {
      throw new RangeError("exObservation must be at or after exAt");
    }
    // Three defensible answers to "how did I do", and none of them is the factor.
    returns = {
      rawPriceReturn: render(observedEx.divide(reference).subtract(ONE)),
      grossTotalReturn: render(observedEx.add(grossPrice).divide(reference).subtract(ONE)),
      netCashReturn: render(observedEx.add(netPrice).divide(reference).subtract(ONE)),
    };
  }

  let taxResult: TaxIllustration | null = null;
  const tax = get(data, "taxIllustration", null);
  if (tax !== null) {
    if (
      typeof tax !== "object" || Array.isArray(tax) ||
      textValue((tax as Record<string, any>).jurisdiction, "taxIllustration.jurisdiction") !==
        US_TAX_SCOPE
    ) {
      throw new RangeError(`tax illustration supports only ${US_TAX_SCOPE}`);
    }
    const row = tax as Record<string, any>;
    if (eventCurrency !== "USD" || textValue(row.currency, "taxIllustration.currency") !== "USD") {
      throw new RangeError("US tax illustration requires USD event and basis amounts");
    }
    textValue(row.sourceId, "taxIllustration.sourceId");
    const taxObserved = parseInstant(row.observedAt, "taxIllustration.observedAt");
    const taxAvailable = parseInstant(row.availableAt, "taxIllustration.availableAt");
    if (taxObserved > taxAvailable || taxAvailable > asOf) {
      throw new RangeError("tax illustration must satisfy observedAt <= availableAt <= asOf");
    }
    const basis = parseDecimal(row.basisPerShareBefore, "basisPerShareBefore");
    const classified = parseDecimal(
      row.confirmedReturnOfCapitalPerShare, "confirmedReturnOfCapitalPerShare",
    );
    // The issuer classifies part of a payment as return of capital, never more than all.
    if (classified.compare(grossEvent) > 0) {
      throw new RangeError(
        "tax-classified return of capital cannot exceed the gross distribution",
      );
    }
    // Basis floors at zero; anything past it is a gain, not a further reduction.
    const reduction = basis.compare(classified) <= 0 ? basis : classified;
    taxResult = {
      basisPerShareAfter: render(basis.subtract(reduction)),
      basisReductionPerShare: render(reduction),
      excessOverBasisPerShare: render(classified.subtract(reduction)),
    };
  }

  return {
    eventId: revision.eventId,
    revisionId: revision.revisionId,
    state: "confirmed",
    applied: true,
    priceCurrency,
    marketDataAdjustment: {
      referencePrice: render(reference),
      // GROSS, because that is what left the company — not what any holder received.
      grossDistributionInPriceCurrency: render(grossPrice),
      theoreticalExPrice: render(theoreticalEx),
      backwardHistoryFactor: render(factor),
      forwardPostEventFactor: render(ONE.divide(factor)),
      factorDirection: "multiply_pre_ex_history_by_backwardHistoryFactor",
      // A theoretical price, not a trade that happened.
      theoreticalPriceIsObservedTrade: false,
    },
    investorReturnDiagnostics: returns,
    usFederalTaxIllustration: taxResult,
  };
}

export { ZERO };
