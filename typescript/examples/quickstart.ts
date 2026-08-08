/**
 * Three views of one payment, and what happens when they get blended.
 *
 * Run:  npm run example
 */

import { createRequire } from "node:module";

import {
  adjustPriceSeries,
  adjustmentBasisComparison,
  basisRunway,
  calculate,
  verifyViews,
} from "../src/index.ts";
import { Rational } from "../src/rational.ts";

const require = createRequire(import.meta.url);
const FIXTURE = require("../test/fixtures/fixtures.json") as Record<string, any>;
const REQUEST = FIXTURE.input as Record<string, any>;

const rule = (title: string) => console.log(`\n${title}\n${"-".repeat(title.length)}`);
const pct = (text: string, digits = 3) => {
  const value = Rational.fromDecimalString(text);
  const scaled = Number(value.numerator) / Number(value.denominator) * 100;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(digits)}%`;
};
const pad = (value: unknown, width: number) => String(value).padStart(width);

const result = calculate(REQUEST);

// --- 1. three views, kept apart ---------------------------------------------------- //
rule("1. One payment, three separate answers");

const market = result.marketDataAdjustment!;
const returns = result.investorReturnDiagnostics!;
const tax = result.usFederalTaxIllustration!;

console.log("  MARKET DATA — what the price series needs");
console.log(`    reference price:        ${market.referencePrice}`);
console.log(`    gross distribution:     ${market.grossDistributionInPriceCurrency}`);
console.log(`    theoretical ex price:   ${market.theoreticalExPrice}`);
console.log(`    backward factor:        ${market.backwardHistoryFactor}`);
console.log("  INVESTOR RETURNS — how a holder did");
console.log(`    price alone:            ${pct(returns.rawPriceReturn)}`);
console.log(`    gross total:            ${pct(returns.grossTotalReturn)}`);
console.log(`    net of cash:            ${pct(returns.netCashReturn)}`);
console.log("  US TAX ILLUSTRATION — what happens to cost basis");
console.log(`    basis reduction:        ${tax.basisReductionPerShare}`);
console.log(`    basis after:            ${tax.basisPerShareAfter}`);
console.log(`    excess over basis:      ${tax.excessOverBasisPerShare}`);
console.log("  A 7.4% 'fall' that is mostly cash the holder received. Three defensible");
console.log("  numbers, and none of them is a substitute for another.");

// --- 2. gross, not net -------------------------------------------------------------- //
rule("2. The classic error: adjusting by the net cash");

const comparison = adjustmentBasisComparison(REQUEST);
console.log(`  gross distribution:        ${comparison.grossDistribution}`);
console.log(`  net of withholding + fees: ${comparison.netDistribution}`);
console.log(
  `  correct theoretical price: ${comparison.correctTheoreticalExPrice}` +
    `   factor ${comparison.correctBackwardFactor}`,
);
console.log(
  `  wrong theoretical price:   ${comparison.wrongTheoreticalExPrice}` +
    `   factor ${comparison.wrongBackwardFactor}`,
);
console.log(
  `  price overstated by:       ${comparison.priceOverstatedBy}` +
    `   (${pct(comparison.relativeError!)} of the price)`,
);
console.log(`  correct basis: ${comparison.correctBasis}`);
console.log("  The gross amount is what left the company. The net amount is what ONE holder");
console.log("  received after their withholding and fees — so a series adjusted by it is");
console.log("  specific to one investor's tax position, and wrong for everybody else.");

// --- 3. every identity closes --------------------------------------------------------- //
rule("3. The numbers check out, exactly");

const check = verifyViews(result);
console.log(`  reference - gross == theoretical:  ${check.priceCloses}`);
console.log(`  factor is the price ratio:         ${check.factorMatchesPriceRatio}`);
console.log(`  forward is the reciprocal:         ${check.factorsAreReciprocal}`);
console.log(`  return ordering holds:             ${check.returnBreaks.length === 0}`);
console.log(`  tax legs are consistent:           ${check.taxBreaks.length === 0}`);
console.log(`  theoretical price is a trade:      ${check.theoreticalPriceIsObservedTrade}`);

const broken = JSON.parse(JSON.stringify(result));
broken.marketDataAdjustment.theoreticalExPrice = "24.00000000";
console.log(`  with the ex price nudged to 24.00: ok=${verifyViews(broken).ok}`);
console.log("  These are exact equalities, not tolerance comparisons. Every amount is a");
console.log("  decimal string, parsed to an exact rational, rounded once at the end.");

// --- 4. adjust the history, either way -------------------------------------------------- //
rule("4. Backward for a return series, forward for a cost basis");

const series = adjustPriceSeries(result, ["25.00000000", "24.00000000", "20.00000000"]);
console.log("  raw price      backward       forward");
for (const row of series.rows) {
  console.log(
    `  ${pad(row.rawPrice, 12)} ${pad(row.backwardAdjusted, 14)}` +
      ` ${pad(row.forwardAdjusted, 14)}`,
  );
}
console.log(
  `  raw ex-date step: ${pct(series.rawExDateStep, 2)}` +
    `   adjusted: ${pct(series.adjustedExDateStep, 2)}`,
);
console.log("  Backward restates history onto the post-event basis, which is what a continuous");
console.log("  return series needs. Forward carries prices back onto the pre-event basis, which");
console.log("  is what a cost basis needs. A return of capital genuinely needs both.");

// --- 5. the basis runs out ---------------------------------------------------------------- //
rule("5. When the basis runs out, the payments become gains");

const ladder = basisRunway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"]);
console.log(`  starting basis: ${ladder.basisBefore}`);
console.log("  payment      reduction        excess     basis after");
for (const row of ladder.rows) {
  console.log(
    `  ${pad(row.classifiedAmount, 10)} ${pad(row.basisReduction, 16)}` +
      ` ${pad(row.excessOverBasis, 13)} ${pad(row.basisAfter, 15)}`,
  );
}
console.log(`  basis exhausted on payment index: ${ladder.exhaustedAtIndex}`);
console.log(
  `  total reduction: ${ladder.totalBasisReduction}` +
    `   total gain: ${ladder.totalExcessOverBasis}`,
);
console.log("  Basis falls until there is none, and everything after that is a GAIN rather");
console.log("  than a further reduction. That crossover is a taxable event nobody schedules,");
console.log("  arriving on whichever payment happens to cross it.");
