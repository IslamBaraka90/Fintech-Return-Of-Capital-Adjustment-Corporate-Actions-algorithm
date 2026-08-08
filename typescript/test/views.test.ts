/** Tests for the identity checks, the gross/net comparison, series adjustment and basis runway. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { calculate } from "../src/core.ts";
import { Rational } from "../src/rational.ts";
import {
  adjustPriceSeries,
  adjustmentBasisComparison,
  basisRunway,
  verifyViews,
} from "../src/views.ts";
import { INPUT, payload, revision, run } from "./fixtures.ts";

const rat = (text: string) => Rational.fromDecimalString(text);

// --- verifyViews ------------------------------------------------------------------- //
test("the fixture closes on every identity", () => {
  const report = verifyViews(run());
  assert.equal(report.ok, true);
  assert.equal(report.priceCloses, true);
  assert.equal(report.factorMatchesPriceRatio, true);
  assert.equal(report.factorsAreReciprocal, true);
  assert.deepEqual(report.returnBreaks, []);
  assert.deepEqual(report.taxBreaks, []);
});

test("a tampered theoretical price breaks closure", () => {
  // The positive control: the checker reads the result, it does not assert a constant.
  const result = run();
  result.marketDataAdjustment!.theoreticalExPrice = "24.00000000";
  const report = verifyViews(result);
  assert.equal(report.priceCloses, false);
  assert.equal(report.ok, false);
});

test("a tampered factor is caught", () => {
  const result = run();
  result.marketDataAdjustment!.backwardHistoryFactor = "0.95000000";
  assert.equal(verifyViews(result).factorMatchesPriceRatio, false);
});

test("a forward factor that is not the reciprocal is caught", () => {
  const result = run();
  result.marketDataAdjustment!.forwardPostEventFactor = "1.50000000";
  assert.equal(verifyViews(result).factorsAreReciprocal, false);
});

test("a net return above the gross return is caught", () => {
  const result = run();
  result.investorReturnDiagnostics!.netCashReturn = "0.50000000";
  const checks = verifyViews(result).returnBreaks.map((row) => row.check);
  assert.ok(checks.includes("grossTotalReturn >= netCashReturn"));
});

test("a negative basis is caught", () => {
  const result = run();
  result.usFederalTaxIllustration!.basisPerShareAfter = "-1.00000000";
  const checks = verifyViews(result).taxBreaks.map((row) => row.check);
  assert.ok(checks.includes("basisPerShareAfter >= 0"));
});

test("basis remaining and excess are mutually exclusive", () => {
  // You cannot both have basis left and have exceeded it.
  const result = run();
  result.usFederalTaxIllustration!.excessOverBasisPerShare = "0.50000000";
  const checks = verifyViews(result).taxBreaks.map((row) => row.check);
  assert.ok(checks.includes("basis remaining and excess are mutually exclusive"));
});

test("the optional views are reported as unchecked when absent", () => {
  const data = payload();
  delete data.exObservation;
  delete data.taxIllustration;
  const report = verifyViews(calculate(data));
  assert.equal(report.returnsChecked, false);
  assert.equal(report.taxChecked, false);
  assert.equal(report.ok, true);
});

test("a cancelled result is refused with a clear reason", () => {
  assert.throws(
    () => verifyViews(run({ revisions: [revision({ status: "cancelled" })] })), /cancelled/,
  );
});

test("verification rejects foreign input", () => {
  assert.throws(() => verifyViews({ state: "confirmed" }), /calculate/);
});

// --- adjustmentBasisComparison ------------------------------------------------------- //
test("the wrong basis overstates the price", () => {
  // Adjusting by the net cash leaves 0.12 of price that should have gone.
  const report = adjustmentBasisComparison(INPUT);
  assert.equal(report.correctTheoreticalExPrice, "23.00000000");
  assert.equal(report.wrongTheoreticalExPrice, "23.12000000");
  assert.equal(report.priceOverstatedBy, "0.12000000");
});

test("the gap is exactly the deductions", () => {
  const report = adjustmentBasisComparison(INPUT);
  assert.equal(report.deductionsPerShare, "0.12000000");
  assert.equal(report.priceOverstatedBy, report.deductionsPerShare);
});

test("the relative error is reported", () => {
  const report = adjustmentBasisComparison(INPUT);
  assert.ok(rat(report.relativeError!).sign > 0);
  assert.equal(report.correctBasis, "gross");
});

test("the two bases agree when there are no deductions", () => {
  const data = payload();
  data.revisions[0].terms = {
    ...data.revisions[0].terms,
    withholdingPerShare: "0.00000000",
    feesPerShare: "0.00000000",
  };
  const report = adjustmentBasisComparison(data);
  assert.equal(report.identical, true);
  assert.equal(report.priceOverstatedBy, "0.00000000");
});

test("the wrong factor is reported too", () => {
  const report = adjustmentBasisComparison(INPUT);
  assert.equal(report.correctBackwardFactor, "0.92000000");
  assert.equal(report.wrongBackwardFactor, "0.92480000");
});

test("the comparison uses the revision the result selected", () => {
  // Reading terms from the wrong revision would misreport the gap.
  const later = revision({
    revisionId: "R2", revisionSequence: 2,
    observedAt: "2025-01-25T14:00:00Z", availableAt: "2025-01-25T14:02:00Z",
  });
  later.terms = { ...later.terms, withholdingPerShare: "0.50000000" };
  const report = adjustmentBasisComparison(
    payload({ revisions: [INPUT.revisions[0], later] }),
  );
  assert.equal(report.deductionsPerShare, "0.52000000");
});

test("the comparison rejects a non-object", () => {
  assert.throws(() => adjustmentBasisComparison("nope"), /data must be an object/);
});

// --- adjustPriceSeries ------------------------------------------------------------------ //
test("the backward factor lands the reference on the theoretical price", () => {
  // Which is the entire point of the factor.
  const row = adjustPriceSeries(run(), ["25.00000000"]).rows[0]!;
  assert.equal(row.backwardAdjusted, "23.00000000");
});

test("both directions are reported", () => {
  // A return of capital is one of the few events where people need both.
  const series = adjustPriceSeries(run(), ["25.00000000"]);
  assert.equal(series.backwardHistoryFactor, "0.92000000");
  assert.equal(series.forwardPostEventFactor, "1.08695652");
  assert.notEqual(series.rows[0]!.forwardAdjusted, series.rows[0]!.backwardAdjusted);
});

test("relative moves within the history are preserved", () => {
  const rows = adjustPriceSeries(run(), ["20.00000000", "22.00000000"]).rows;
  const rawRatio = rat("22.00000000").divide(rat("20.00000000"));
  const adjustedRatio = rat(rows[1]!.backwardAdjusted).divide(rat(rows[0]!.backwardAdjusted));
  assert.ok(
    adjustedRatio.subtract(rawRatio).abs().compare(new Rational(1n, 1_000_000n)) < 0,
  );
});

test("the ex-date step is removed", () => {
  const series = adjustPriceSeries(run(), ["25.00000000"]);
  assert.equal(series.rawExDateStep, "-0.08000000");
  assert.equal(series.adjustedExDateStep, "0.00000000");
});

test("prices are decimal strings in and out", () => {
  const row = adjustPriceSeries(run(), ["25.00000000"]).rows[0]!;
  assert.ok(Object.values(row).every((value) => typeof value === "string"));
});

for (const bad of ["0.00000000", "-1.00000000", "abc", 25.0, null] as unknown[]) {
  test(`a bad price raises (${String(bad)})`, () => {
    assert.throws(() => adjustPriceSeries(run(), [bad]));
  });
}

test("an empty price list raises", () => {
  assert.throws(() => adjustPriceSeries(run(), []), /non-empty list/);
});

test("series adjustment refuses a cancelled result", () => {
  assert.throws(
    () => adjustPriceSeries(
      run({ revisions: [revision({ status: "cancelled" })] }), ["25.00000000"],
    ),
    /cancelled/,
  );
});

// --- basisRunway ---------------------------------------------------------------------------- //
test("the basis falls until it is gone", () => {
  const ladder = basisRunway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"]);
  assert.deepEqual(ladder.rows.map((row) => row.basisAfter), [
    "0.30000000", "0.00000000", "0.00000000",
  ]);
});

test("the crossover payment is identified", () => {
  // A taxable event nobody puts in a calendar, arriving on whichever payment crosses.
  const ladder = basisRunway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"]);
  assert.equal(ladder.basisExhausted, true);
  assert.equal(ladder.exhaustedAtIndex, 1);
  assert.equal(ladder.rows[1]!.excessOverBasis, "0.20000000");
});

test("everything after the crossover is a gain", () => {
  const ladder = basisRunway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"]);
  assert.equal(ladder.rows[2]!.basisReduction, "0.00000000");
  assert.equal(ladder.rows[2]!.excessOverBasis, "0.30000000");
  assert.equal(ladder.totalExcessOverBasis, "0.50000000");
});

test("the reductions and excesses account for every payment", () => {
  const payments = ["1.20000000", "0.50000000", "0.30000000"];
  const ladder = basisRunway("1.50000000", payments);
  const total = rat(ladder.totalBasisReduction).add(rat(ladder.totalExcessOverBasis));
  const paid = payments.reduce(
    (sum, amount) => sum.add(rat(amount)), new Rational(0n),
  );
  assert.ok(total.equals(paid));
});

test("a basis that survives is reported as not exhausted", () => {
  const ladder = basisRunway("5.00000000", ["1.20000000"]);
  assert.equal(ladder.basisExhausted, false);
  assert.equal(ladder.exhaustedAtIndex, null);
  assert.equal(ladder.basisAfter, "3.80000000");
});

test("a zero basis makes every payment a gain", () => {
  const ladder = basisRunway("0.00000000", ["1.00000000", "2.00000000"]);
  assert.equal(ladder.totalBasisReduction, "0.00000000");
  assert.equal(ladder.totalExcessOverBasis, "3.00000000");
  assert.equal(ladder.exhaustedAtIndex, 0);
});

test("an empty payment list raises", () => {
  assert.throws(() => basisRunway("1.50000000", []), /non-empty list/);
});

for (const bad of ["-1.00000000", "abc", 1.5, null] as unknown[]) {
  test(`a bad payment amount raises (${String(bad)})`, () => {
    assert.throws(() => basisRunway("1.50000000", [bad]));
  });
}

// --- the surfaces agree ------------------------------------------------------------------------ //
test("the single-event runway matches the tax illustration", () => {
  // The runway is the same arithmetic, run over a sequence instead of one payment.
  const tax = run().usFederalTaxIllustration!;
  const ladder = basisRunway("1.50000000", ["1.20000000"]);
  assert.equal(ladder.rows[0]!.basisReduction, tax.basisReductionPerShare);
  assert.equal(ladder.rows[0]!.basisAfter, tax.basisPerShareAfter);
  assert.equal(ladder.rows[0]!.excessOverBasis, tax.excessOverBasisPerShare);
});

test("the correct comparison branch matches the calculation", () => {
  const report = adjustmentBasisComparison(INPUT);
  const market = run().marketDataAdjustment!;
  assert.equal(report.correctTheoreticalExPrice, market.theoreticalExPrice);
  assert.equal(report.correctBackwardFactor, market.backwardHistoryFactor);
});
