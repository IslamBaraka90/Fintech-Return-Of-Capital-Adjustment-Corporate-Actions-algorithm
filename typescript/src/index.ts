/**
 * Return of capital: a payment that is not income, and three views that must stay apart.
 *
 * A return of capital hands cash back out of **capital rather than earnings**. The price
 * falls like any distribution, but the tax treatment is different: it reduces cost basis
 * rather than being taxed as income, and only the part exceeding basis becomes a gain.
 *
 * Three views are kept separate and never blended — the market-data adjustment (which uses
 * the **gross** amount, because that is what left the company), the investor return
 * diagnostics, and a US federal tax illustration scoped to one jurisdiction and one year.
 *
 * Every monetary value is a plain decimal string, in and out. No floats cross the interface.
 *
 * ```ts
 * import { calculate } from "fintech-return-of-capital";
 *
 * const result = calculate({ asOf: "2025-02-03T21:05:00Z", revisions: [...], ... });
 * console.log(result.marketDataAdjustment.theoreticalExPrice);
 * ```
 *
 * Article: https://thefintechbuilder.com/corporate-actions-and-security-master-data/complex-distributions/return-of-capital-adjustment/
 */

export {
  type MarketDataAdjustment,
  type ReturnDiagnostics,
  type ReturnOfCapitalResult,
  type TaxIllustration,
  FX_ANCHOR_POLICY,
  OUTPUT_DECIMALS,
  STATUSES,
  US_TAX_SCOPE,
  calculate,
  parseDecimal,
  parseInstant,
  render,
  selectRevision,
} from "./core.ts";

export { Rational } from "./rational.ts";

export {
  type AdjustedSeries,
  type BasisComparison,
  type BasisRunway,
  type ViewReport,
  adjustPriceSeries,
  adjustmentBasisComparison,
  basisRunway,
  verifyViews,
} from "./views.ts";
