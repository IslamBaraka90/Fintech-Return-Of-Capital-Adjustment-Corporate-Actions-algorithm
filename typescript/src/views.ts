/**
 * Keeping the three views apart, and showing what happens when they get blended.
 *
 * **Do the numbers close?** — {@link verifyViews}
 * The factor is the price ratio, the forward factor is its reciprocal, the tax legs sum to
 * the classified amount. All exact, because the module never leaves rational arithmetic.
 *
 * **What if you adjust by the wrong amount?** — {@link adjustmentBasisComparison}
 * The single most common error in this topic: adjusting a price series by the **net** cash a
 * holder received rather than the **gross** amount that left the company.
 *
 * **Adjust the history** — {@link adjustPriceSeries}
 * The factor exists to make the series continuous. This applies it, in either direction.
 *
 * **How much basis is left?** — {@link basisRunway}
 * A return of capital reduces basis until there is none, and then becomes a gain. That
 * crossover is a tax event nobody schedules for.
 */

import { ONE, Rational, ZERO } from "./rational.ts";
import { calculate, parseDecimal, render } from "./core.ts";

/** One part in 1e8 — the published precision, not machine epsilon. */
const PUBLISHED_TOLERANCE = new Rational(1n, 100_000_000n);

export interface ViewReport {
  priceCloses: boolean;
  factorMatchesPriceRatio: boolean;
  factorsAreReciprocal: boolean;
  returnsChecked: boolean;
  returnBreaks: Array<Record<string, unknown>>;
  taxChecked: boolean;
  taxBreaks: Array<Record<string, unknown>>;
  theoreticalPriceIsObservedTrade: boolean;
  ok: boolean;
}

export interface BasisComparison {
  referencePrice: string;
  grossDistribution: string;
  netDistribution: string;
  correctTheoreticalExPrice: string;
  wrongTheoreticalExPrice: string;
  correctBackwardFactor: string;
  wrongBackwardFactor: string;
  priceOverstatedBy: string;
  relativeError: string | null;
  deductionsPerShare: string;
  identical: boolean;
  correctBasis: string;
}

export interface AdjustedSeries {
  factorDirection: string;
  backwardHistoryFactor: string;
  forwardPostEventFactor: string;
  rows: Array<{ rawPrice: string; backwardAdjusted: string; forwardAdjusted: string }>;
  rawExDateStep: string;
  adjustedExDateStep: string;
}

export interface BasisRunway {
  basisBefore: string;
  rows: Array<Record<string, string>>;
  basisAfter: string;
  totalBasisReduction: string;
  totalExcessOverBasis: string;
  basisExhausted: boolean;
  exhaustedAtIndex: number | null;
  paymentsBeforeExhaustion: number | null;
}

function requireApplied(result: unknown): Record<string, any> {
  if (result === null || typeof result !== "object" || !("state" in result)) {
    throw new RangeError("result must come from calculate()");
  }
  const diagnosis = result as Record<string, any>;
  if (diagnosis.state === "cancelled") {
    throw new RangeError("the selected revision was cancelled; there is nothing to adjust");
  }
  if (!diagnosis.applied || !("marketDataAdjustment" in diagnosis)) {
    throw new RangeError("result must come from calculate()");
  }
  return diagnosis;
}

/**
 * Read a published decimal string back into the exact rational it came from.
 *
 * Published strings may be negative (a return diagnostic), which is why this is separate
 * from `parseDecimal` — that one guards *inputs*, which must be non-negative.
 */
function value(text: unknown, name: string): Rational {
  if (typeof text !== "string" || text === "") {
    throw new RangeError(`${name} must be a decimal string`);
  }
  return Rational.fromDecimalString(text);
}

/** The revision the calculation actually used, found by the id it reported. */
function selectedRevision(data: Record<string, any>, revisionId: string): Record<string, any> {
  for (const revision of data.revisions ?? []) {
    if (revision && typeof revision === "object" && revision.revisionId === revisionId) {
      return revision as Record<string, any>;
    }
  }
  throw new RangeError("data does not contain the revision the result was built from");
}

/**
 * Check the identities that hold inside each view, and the one that spans two.
 *
 * - **The theoretical price closes** exactly.
 * - **The factor is the price ratio**, and the forward factor is its reciprocal — checked at
 *   the published eight-decimal precision, since both are rounded before you see them.
 * - **The tax legs are non-negative**, the basis never goes negative, and having basis left
 *   is mutually exclusive with having exceeded it.
 * - **Gross total return >= net cash return >= raw price return.** Withholding and fees can
 *   only reduce what a holder ends up with.
 */
export function verifyViews(result: unknown): ViewReport {
  const diagnosis = requireApplied(result);
  const market = diagnosis.marketDataAdjustment as Record<string, any>;
  const reference = value(market.referencePrice, "referencePrice");
  const gross = value(market.grossDistributionInPriceCurrency, "gross");
  const theoretical = value(market.theoreticalExPrice, "theoreticalExPrice");
  const backward = value(market.backwardHistoryFactor, "backwardHistoryFactor");
  const forward = value(market.forwardPostEventFactor, "forwardPostEventFactor");

  const priceCloses = reference.subtract(gross).equals(theoretical);
  const factorMatches =
    backward.subtract(theoretical.divide(reference)).abs().compare(PUBLISHED_TOLERANCE) <= 0;
  // Rounded independently, so the round trip is checked at the published precision.
  const factorsReciprocal =
    backward.sign !== 0 &&
    backward.multiply(forward).subtract(ONE).abs()
      .compare(PUBLISHED_TOLERANCE.multiply(new Rational(2n))) <= 0;

  const returns = diagnosis.investorReturnDiagnostics ?? null;
  const returnBreaks: Array<Record<string, unknown>> = [];
  if (returns !== null) {
    const raw = value(returns.rawPriceReturn, "rawPriceReturn");
    const grossReturn = value(returns.grossTotalReturn, "grossTotalReturn");
    const netReturn = value(returns.netCashReturn, "netCashReturn");
    if (grossReturn.compare(netReturn) < 0) {
      returnBreaks.push({ check: "grossTotalReturn >= netCashReturn" });
    }
    if (netReturn.compare(raw) < 0) {
      returnBreaks.push({ check: "netCashReturn >= rawPriceReturn" });
    }
  }

  const tax = diagnosis.usFederalTaxIllustration ?? null;
  const taxBreaks: Array<Record<string, unknown>> = [];
  if (tax !== null) {
    const after = value(tax.basisPerShareAfter, "basisPerShareAfter");
    const reduction = value(tax.basisReductionPerShare, "basisReductionPerShare");
    const excess = value(tax.excessOverBasisPerShare, "excessOverBasisPerShare");
    if (after.sign < 0) taxBreaks.push({ check: "basisPerShareAfter >= 0" });
    // You cannot both have basis left and have exceeded it.
    if (after.sign > 0 && excess.sign > 0) {
      taxBreaks.push({ check: "basis remaining and excess are mutually exclusive" });
    }
    if (reduction.sign < 0 || excess.sign < 0) {
      taxBreaks.push({ check: "tax legs are non-negative" });
    }
  }

  return {
    priceCloses,
    factorMatchesPriceRatio: factorMatches,
    factorsAreReciprocal: factorsReciprocal,
    returnsChecked: returns !== null,
    returnBreaks,
    taxChecked: tax !== null,
    taxBreaks,
    // A theoretical price is not a trade, and the result says so.
    theoreticalPriceIsObservedTrade: market.theoreticalPriceIsObservedTrade,
    ok: priceCloses && factorMatches && factorsReciprocal &&
      returnBreaks.length === 0 && taxBreaks.length === 0,
  };
}

/**
 * Price the classic error: adjusting by the net cash instead of the gross distribution.
 *
 * The market-data adjustment uses the **gross** amount because that is what left the
 * company. The net amount is what a *particular holder* received after withholding and fees,
 * and it varies by holder — so using it produces a price series specific to one investor's
 * tax position and wrong for everybody else, including them next year.
 */
export function adjustmentBasisComparison(data: unknown): BasisComparison {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }
  const source = data as Record<string, any>;
  const correct = calculate(source);
  const market = correct.marketDataAdjustment!;

  const reference = value(market.referencePrice, "referencePrice");
  const gross = value(market.grossDistributionInPriceCurrency, "gross");

  // Rebuild the net-of-cash distribution from the same terms and FX the calculation used.
  const revision = selectedRevision(source, correct.revisionId);
  const terms = revision.terms;
  const withholding = parseDecimal(
    "withholdingPerShare" in terms ? terms.withholdingPerShare : "0", "withholdingPerShare",
  );
  const fees = parseDecimal(
    "feesPerShare" in terms ? terms.feesPerShare : "0", "feesPerShare",
  );
  const fx = parseDecimal(
    source.fxObservation.priceCurrencyPerEventCurrency, "fx", { positive: true },
  );
  const deductions = withholding.add(fees).multiply(fx);
  const netDistribution = gross.subtract(deductions);

  const wrongTheoretical = reference.subtract(netDistribution);
  const wrongFactor = reference.sign ? wrongTheoretical.divide(reference) : ZERO;
  const correctTheoretical = value(market.theoreticalExPrice, "theoreticalExPrice");

  return {
    referencePrice: market.referencePrice,
    grossDistribution: market.grossDistributionInPriceCurrency,
    netDistribution: render(netDistribution),
    correctTheoreticalExPrice: market.theoreticalExPrice,
    wrongTheoreticalExPrice: render(wrongTheoretical),
    correctBackwardFactor: market.backwardHistoryFactor,
    wrongBackwardFactor: render(wrongFactor),
    // What the mistake costs, per share and as a fraction of the price.
    priceOverstatedBy: render(wrongTheoretical.subtract(correctTheoretical)),
    relativeError: correctTheoretical.sign
      ? render(wrongTheoretical.subtract(correctTheoretical).divide(correctTheoretical))
      : null,
    deductionsPerShare: render(deductions),
    identical: deductions.sign === 0,
    correctBasis: "gross",
  };
}

/**
 * Apply the factor to a price history, backward or forward.
 *
 * `backward` restates pre-ex prices onto the post-event basis, which is what a continuous
 * return series needs. `forward` carries post-event prices back onto the pre-event basis,
 * which is what a cost basis or a filed figure needs. A return of capital is one of the few
 * events where people genuinely want both.
 */
export function adjustPriceSeries(result: unknown, prices: unknown): AdjustedSeries {
  const diagnosis = requireApplied(result);
  if (!Array.isArray(prices) || prices.length === 0) {
    throw new TypeError("prices must be a non-empty list");
  }
  const market = diagnosis.marketDataAdjustment as Record<string, any>;
  const backward = value(market.backwardHistoryFactor, "backwardHistoryFactor");
  const forward = value(market.forwardPostEventFactor, "forwardPostEventFactor");

  const rows = prices.map((price, index) => {
    const amount = parseDecimal(price, `prices[${index}]`, { positive: true });
    return {
      rawPrice: render(amount),
      backwardAdjusted: render(amount.multiply(backward)),
      forwardAdjusted: render(amount.multiply(forward)),
    };
  });

  return {
    factorDirection: market.factorDirection,
    backwardHistoryFactor: market.backwardHistoryFactor,
    forwardPostEventFactor: market.forwardPostEventFactor,
    rows,
    rawExDateStep: render(backward.subtract(ONE)),
    adjustedExDateStep: render(ZERO),
  };
}

/**
 * Run a sequence of return-of-capital payments against one cost basis.
 *
 * Basis falls until it reaches zero, and everything after that is a **gain** rather than a
 * further reduction. That crossover is a taxable event nobody puts in a calendar, and it
 * arrives on whichever payment happens to cross it.
 *
 * Deliberately independent of {@link calculate}: the amounts here are what the issuer
 * *classified* as return of capital, which is not the same as what it distributed.
 */
export function basisRunway(basisBefore: unknown, classifiedAmounts: unknown): BasisRunway {
  if (!Array.isArray(classifiedAmounts) || classifiedAmounts.length === 0) {
    throw new TypeError("classified_amounts must be a non-empty list");
  }

  const start = parseDecimal(basisBefore, "basis_before");
  let basis = start;
  const rows: Array<Record<string, string>> = [];
  let totalReduction = ZERO;
  let totalExcess = ZERO;
  let exhaustedAt: number | null = null;

  classifiedAmounts.forEach((amount, index) => {
    const classified = parseDecimal(amount, `classified_amounts[${index}]`);
    const reduction = basis.compare(classified) <= 0 ? basis : classified;
    const excess = classified.subtract(reduction);
    basis = basis.subtract(reduction);
    totalReduction = totalReduction.add(reduction);
    totalExcess = totalExcess.add(excess);
    if (basis.sign === 0 && exhaustedAt === null) exhaustedAt = index;
    rows.push({
      classifiedAmount: render(classified),
      basisReduction: render(reduction),
      excessOverBasis: render(excess),
      basisAfter: render(basis),
    });
  });

  return {
    basisBefore: render(start),
    rows,
    basisAfter: render(basis),
    totalBasisReduction: render(totalReduction),
    // Everything past the crossover is a gain, not a reduction.
    totalExcessOverBasis: render(totalExcess),
    basisExhausted: basis.sign === 0,
    exhaustedAtIndex: exhaustedAt,
    paymentsBeforeExhaustion: exhaustedAt,
  };
}
