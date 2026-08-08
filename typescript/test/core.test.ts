/**
 * Contract tests for the return-of-capital adjustment.
 *
 * The fixture is the cross-language acceptance anchor: a 2.00 USD capital return against a
 * 25.00 close, with 0.10 withholding and 0.02 fees, an observed ex close, and a US federal
 * tax illustration against a 1.50 basis. Its complete expected output is asserted verbatim
 * here and by the Python suite.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  US_TAX_SCOPE, calculate, parseDecimal, parseInstant, render, selectRevision,
} from "../src/core.ts";
import { Rational } from "../src/rational.ts";
import {
  CASE_LABEL, EXPECTED, INPUT, R1, TOPIC_ID, payload, revision, run, runTerms, section,
} from "./fixtures.ts";

const rat = (text: string) => Rational.fromDecimalString(text);

// --- the shared fixture ------------------------------------------------------------ //
test("the whole result matches the fixture", () => {
  assert.deepEqual(calculate(INPUT), EXPECTED);
});

test("the fixture is the documented topic", () => {
  assert.equal(TOPIC_ID, "D02-F02-A05");
  assert.ok(CASE_LABEL.toLowerCase().includes("synthetic"));
});

test("the exact worked values", () => {
  const market = run().marketDataAdjustment!;
  assert.equal(market.referencePrice, "25.00000000");
  assert.equal(market.grossDistributionInPriceCurrency, "2.00000000");
  assert.equal(market.theoreticalExPrice, "23.00000000");
  assert.equal(market.backwardHistoryFactor, "0.92000000");
  assert.equal(market.forwardPostEventFactor, "1.08695652");
});

test("every monetary value is a decimal string", () => {
  // No float crosses the interface in either direction.
  const market = run().marketDataAdjustment! as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(market)) {
    if (key === "factorDirection" || key === "theoreticalPriceIsObservedTrade") continue;
    assert.equal(typeof value, "string");
    assert.equal((value as string).split(".")[1]!.length, 8);
  }
});

test("the theoretical price is not a trade", () => {
  assert.equal(run().marketDataAdjustment!.theoreticalPriceIsObservedTrade, false);
});

test("the factor direction is published", () => {
  assert.equal(
    run().marketDataAdjustment!.factorDirection,
    "multiply_pre_ex_history_by_backwardHistoryFactor",
  );
});

// --- the three views stay apart ---------------------------------------------------------- //
test("the price adjustment uses the gross amount", () => {
  // What left the company, not what any particular holder received.
  const market = run().marketDataAdjustment!;
  assert.equal(market.grossDistributionInPriceCurrency, "2.00000000");
  // Net would be 1.88, and would produce 23.12 rather than 23.
  assert.equal(market.theoreticalExPrice, "23.00000000");
});

test("the return diagnostics give three different answers", () => {
  const returns = run().investorReturnDiagnostics!;
  assert.equal(returns.rawPriceReturn, "-0.07400000");
  assert.equal(returns.grossTotalReturn, "0.00600000");
  assert.equal(returns.netCashReturn, "0.00120000");
});

test("the price alone understates the outcome", () => {
  // A 7.4% 'fall' that is mostly cash the holder received.
  const returns = run().investorReturnDiagnostics!;
  assert.ok(rat(returns.rawPriceReturn).sign < 0);
  assert.ok(rat(returns.netCashReturn).sign > 0);
});

test("withholding and fees only appear in the net return", () => {
  const returns = run().investorReturnDiagnostics!;
  assert.ok(rat(returns.grossTotalReturn).compare(rat(returns.netCashReturn)) > 0);
  // And nowhere in the price adjustment.
  assert.equal(run().marketDataAdjustment!.grossDistributionInPriceCurrency, "2.00000000");
});

test("the tax illustration reduces basis", () => {
  const tax = run().usFederalTaxIllustration!;
  assert.equal(tax.basisReductionPerShare, "1.20000000");
  assert.equal(tax.basisPerShareAfter, "0.30000000");
  assert.equal(tax.excessOverBasisPerShare, "0.00000000");
});

test("the tax view uses the classified amount, not the distribution", () => {
  // The issuer distributed 2.00 and classified only 1.20 as return of capital.
  assert.equal(run().usFederalTaxIllustration!.basisReductionPerShare, "1.20000000");
  assert.equal(run().marketDataAdjustment!.grossDistributionInPriceCurrency, "2.00000000");
});

test("a classification above the basis becomes an excess", () => {
  // Basis floors at zero and the remainder is a gain, not a further reduction.
  const tax = run({ taxIllustration: section("taxIllustration", {
    confirmedReturnOfCapitalPerShare: "1.80000000",
  }) }).usFederalTaxIllustration!;
  assert.equal(tax.basisReductionPerShare, "1.50000000");
  assert.equal(tax.basisPerShareAfter, "0.00000000");
  assert.equal(tax.excessOverBasisPerShare, "0.30000000");
});

test("a classification above the distribution raises", () => {
  assert.throws(() => run({ taxIllustration: section("taxIllustration", {
    confirmedReturnOfCapitalPerShare: "3.00000000",
  }) }), /cannot exceed the gross distribution/);
});

test("the tax illustration is scoped to one jurisdiction", () => {
  assert.throws(
    () => run({ taxIllustration: section("taxIllustration", { jurisdiction: "UK_2025" }) }),
    new RegExp(US_TAX_SCOPE),
  );
});

test("the tax illustration requires USD", () => {
  assert.throws(
    () => run({ taxIllustration: section("taxIllustration", { currency: "EUR" }) }),
    /requires USD/,
  );
});

test("the optional views are genuinely optional", () => {
  const data = payload();
  delete data.exObservation;
  delete data.taxIllustration;
  const result = calculate(data);
  assert.equal(result.investorReturnDiagnostics, null);
  assert.equal(result.usFederalTaxIllustration, null);
  assert.equal(result.marketDataAdjustment!.theoreticalExPrice, "23.00000000");
});

// --- decimal strings, not floats ------------------------------------------------------------ //
for (const bad of [2.0, 2, null, true, [], {}] as unknown[]) {
  test(`a non-string amount raises (${JSON.stringify(bad)})`, () => {
    assert.throws(
      () => runTerms({ grossCapitalReturnPerShare: bad }), /plain decimal string/,
    );
  });
}

for (const bad of ["2e0", "2E0", "1e-8"]) {
  test(`exponent notation is refused (${bad})`, () => {
    // It is not a *plain* decimal, and accepting it would blur the published precision.
    assert.throws(
      () => runTerms({ grossCapitalReturnPerShare: bad }), /plain decimal string/,
    );
  });
}

for (const bad of ["-1.00", "abc", "", "1.2.3", " 1.0"]) {
  test(`a malformed or negative amount raises (${JSON.stringify(bad)})`, () => {
    assert.throws(() => runTerms({ grossCapitalReturnPerShare: bad }));
  });
}

test("more than eight decimal places raises", () => {
  // Silently truncating a ninth would be worse than saying so.
  assert.throws(
    () => runTerms({ grossCapitalReturnPerShare: "2.000000001" }),
    /at most 8 decimal places/,
  );
});

test("exactly eight decimal places is accepted", () => {
  assert.equal(runTerms({ grossCapitalReturnPerShare: "2.00000001" }).applied, true);
});

test("a zero price raises", () => {
  assert.throws(
    () => run({ referenceObservation: section("referenceObservation", {
      price: "0.00000000",
    }) }),
    /must be positive/,
  );
});

test("rendering is half away from zero", () => {
  assert.equal(render(new Rational(1n, 200_000_000n)), "0.00000001");
  assert.equal(render(new Rational(-1n, 200_000_000n)), "-0.00000001");
});

test("rendering always pads to eight places", () => {
  assert.equal(render(new Rational(1n)), "1.00000000");
  assert.equal(render(new Rational(0n)), "0.00000000");
});

test("parseDecimal returns an exact rational", () => {
  // 0.1 as a string is exactly 1/10; as a float it is not.
  assert.ok(parseDecimal("0.10000000", "x").equals(new Rational(1n, 10n)));
  assert.ok(
    parseDecimal("0.10000000", "x").add(parseDecimal("0.20000000", "x"))
      .equals(parseDecimal("0.30000000", "x")),
  );
});

// --- deductions and currency ------------------------------------------------------------------ //
test("deductions above the distribution raise", () => {
  assert.throws(
    () => runTerms({ withholdingPerShare: "1.50000000", feesPerShare: "1.00000000" }),
    /cannot exceed the gross distribution/,
  );
});

test("deductions default to zero when absent", () => {
  const data = payload();
  const terms = { ...data.revisions[0].terms };
  delete terms.withholdingPerShare;
  delete terms.feesPerShare;
  data.revisions[0].terms = terms;
  const returns = calculate(data).investorReturnDiagnostics!;
  // With no deductions the net and gross returns coincide.
  assert.equal(returns.netCashReturn, returns.grossTotalReturn);
});

test("a same-currency event requires an identity FX rate", () => {
  assert.throws(
    () => run({ fxObservation: section("fxObservation", {
      priceCurrencyPerEventCurrency: "1.10000000",
    }) }),
    /identity FX rate/,
  );
});

test("a cross-currency event converts and needs a matching pair", () => {
  const data = payload();
  data.revisions[0].terms.eventCurrency = "EUR";
  data.fxObservation = {
    ...data.fxObservation, priceCurrencyPerEventCurrency: "1.10000000", pair: "EUR/USD",
  };
  delete data.taxIllustration;              // the illustration is USD-only
  assert.equal(
    calculate(data).marketDataAdjustment!.grossDistributionInPriceCurrency, "2.20000000",
  );
});

test("a mismatched FX pair raises", () => {
  const data = payload();
  data.revisions[0].terms.eventCurrency = "EUR";
  data.fxObservation = {
    ...data.fxObservation, priceCurrencyPerEventCurrency: "1.10000000", pair: "USD/EUR",
  };
  delete data.taxIllustration;
  assert.throws(() => calculate(data), /FX pair must be/);
});

test("an FX rate observed after the reference raises", () => {
  // It would mix two market states into one number.
  assert.throws(() => run({ fxObservation: section("fxObservation", {
    observedAt: "2025-02-01T21:00:00Z", availableAt: "2025-02-01T21:00:00Z",
  }) }), /on or before the reference observation/);
});

test("an unsupported FX anchor policy raises", () => {
  assert.throws(
    () => run({ fxObservation: section("fxObservation", {
      anchorPolicy: "LATEST_AVAILABLE",
    }) }),
    /unsupported FX anchor policy/,
  );
});

// --- the timeline and same-day ordering --------------------------------------------------------- //
test("a reference observed on or after the ex instant raises", () => {
  // A price observed at the ex instant is already ex, so it is not a reference.
  assert.throws(() => run({ referenceObservation: section("referenceObservation", {
    observedAt: "2025-02-03T14:30:00Z", availableAt: "2025-02-03T14:30:05Z",
  }) }), /must precede exAt/);
});

test("an ex observation before the ex instant raises", () => {
  assert.throws(() => run({ exObservation: section("exObservation", {
    observedAt: "2025-02-03T13:00:00Z", availableAt: "2025-02-03T13:00:04Z",
  }) }), /at or after exAt/);
});

test("an observation not yet available raises", () => {
  assert.throws(
    () => run({ referenceObservation: section("referenceObservation", {
      availableAt: "2025-02-04T00:00:00Z",
    }) }),
    /observedAt <= availableAt <= asOf/,
  );
});

test("availability before observation raises", () => {
  assert.throws(
    () => run({ referenceObservation: section("referenceObservation", {
      availableAt: "2025-01-31T20:00:00Z",
    }) }),
    /observedAt <= availableAt/,
  );
});

test("a same-day sequence must name every earlier action", () => {
  // A reference price that does not know what already moved it today is not a reference.
  assert.throws(
    () => run({ revisions: [revision({
      sameDayOrdering: { sequence: 2, priorEventIds: [] },
    })] }),
    /every earlier same-day action/,
  );
});

test("a later same-day sequence with its priors named is accepted", () => {
  const result = run({ revisions: [revision({
    sameDayOrdering: { sequence: 2, priorEventIds: ["SYN-EARLIER-SPLIT"] },
  })] });
  assert.equal(result.applied, true);
});

for (const bad of [0, -1, 1.5, "1", true] as unknown[]) {
  test(`a bad same-day sequence raises (${String(bad)})`, () => {
    assert.throws(() => run({ revisions: [revision({
      sameDayOrdering: { sequence: bad, priorEventIds: [] },
    })] }));
  });
}

test("a blank prior event id raises", () => {
  assert.throws(
    () => run({ revisions: [revision({
      sameDayOrdering: { sequence: 2, priorEventIds: [""] },
    })] }),
    /every earlier same-day action/,
  );
});

// --- point-in-time revision selection ------------------------------------------------------------ //
test("the latest available revision wins", () => {
  const later = revision({
    revisionId: "SYN-ANNOUNCEMENT-R2", revisionSequence: 2,
    observedAt: "2025-01-25T14:00:00Z", availableAt: "2025-01-25T14:02:00Z",
  });
  later.terms = { ...later.terms, grossCapitalReturnPerShare: "2.50000000" };
  const result = calculate(payload({ revisions: [R1, later] }));
  assert.equal(result.revisionId, "SYN-ANNOUNCEMENT-R2");
  assert.equal(result.marketDataAdjustment!.theoreticalExPrice, "22.50000000");
});

test("a revision published after asOf is not used", () => {
  const late = revision({
    revisionId: "LATE", revisionSequence: 2,
    observedAt: "2025-02-04T00:00:00Z", availableAt: "2025-02-04T00:00:00Z",
  });
  assert.equal(calculate(payload({ revisions: [R1, late] })).revisionId, R1.revisionId);
});

test("no available revision raises", () => {
  assert.throws(
    () => run({ asOf: "2025-01-01T00:00:00Z" }), /no event revision was available/,
  );
});

test("a cancelled revision returns a complete answer", () => {
  // A withdrawn event is a state, not an error.
  const result = run({ revisions: [revision({ status: "cancelled" })] });
  assert.equal(result.state, "cancelled");
  assert.equal(result.applied, false);
  assert.equal(result.marketDataAdjustment, undefined);
});

test("a revision available before it was observed raises", () => {
  assert.throws(
    () => run({ revisions: [revision({ availableAt: "2025-01-19T00:00:00Z" })] }),
    /observedAt <= availableAt/,
  );
});

test("two event ids in one call raise", () => {
  assert.throws(() => run({ revisions: [R1, revision({
    eventId: "OTHER", revisionId: "OTHER-R1", revisionSequence: 2,
  })] }), /one eventId/);
});

test("a duplicate revision identity raises", () => {
  assert.throws(() => run({ revisions: [R1, R1] }), /duplicate revision identity/);
});

for (const bad of ["pending", "", null] as unknown[]) {
  test(`an unrecognised status raises (${String(bad)})`, () => {
    assert.throws(() => run({ revisions: [revision({ status: bad })] }));
  });
}

test("selectRevision is usable on its own", () => {
  const chosen = selectRevision([R1], parseInstant(INPUT.asOf, "asOf"));
  assert.equal(chosen.revisionId, R1.revisionId);
});

// --- input hygiene --------------------------------------------------------------------------------- //
test("a distribution that exhausts the price raises", () => {
  assert.throws(
    () => runTerms({ grossCapitalReturnPerShare: "30.00000000" }),
    /positive theoretical ex-price/,
  );
});

test("a non-object payload raises", () => {
  assert.throws(() => calculate("nope"), /payload must be an object/);
});

test("the input is never mutated", () => {
  const data = payload();
  const before = JSON.stringify(data);
  calculate(data);
  assert.equal(JSON.stringify(data), before);
});

test("a naive timestamp is refused", () => {
  assert.throws(() => run({ asOf: "2025-02-03T21:05:00" }), /UTC offset/);
});

test("an impossible calendar date is refused", () => {
  assert.throws(() => parseInstant("2025-02-30T00:00:00Z", "t"), /day outside the month/);
});

test("a leap day is accepted in a leap year only", () => {
  assert.ok(parseInstant("2024-02-29T00:00:00Z", "t") > 0);
  assert.throws(() => parseInstant("2025-02-29T00:00:00Z", "t"), /day outside the month/);
});

test("a century leap year follows the four-hundred-year rule", () => {
  assert.ok(parseInstant("2000-02-29T00:00:00Z", "t") > 0);
  assert.throws(() => parseInstant("1900-02-29T00:00:00Z", "t"), /day outside the month/);
});

test("the event and revision ids travel into the result", () => {
  const result = run();
  assert.equal(result.eventId, "SYN-ROC-2025-001");
  assert.equal(result.revisionId, "SYN-ANNOUNCEMENT-R1");
  assert.equal(result.priceCurrency, "USD");
});
