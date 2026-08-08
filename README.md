# Fintech Return-of-Capital Adjustment — Corporate Actions Algorithm

> A canonical, well-specified, **cross-language (Python + TypeScript)** reference
> implementation of the return-of-capital adjustment. A return of capital hands cash back out
> of **capital rather than earnings** — the price falls like any distribution, but it reduces
> your cost basis instead of being taxed as income, and only the part exceeding basis becomes
> a gain. So this module keeps **three views separate on purpose** and never blends them: the
> market-data adjustment (which uses the **gross** amount, because that is what left the
> company), the investor return diagnostics, and a US federal tax illustration. Every
> monetary value is a plain decimal string — **no float crosses the interface** in either
> direction.

<p>
  <img alt="Python" src="https://img.shields.io/badge/python-3.10%2B-blue">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.7%2B-3178c6">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Tests" src="https://img.shields.io/badge/tests-117%20py%20%2F%20117%20ts-brightgreen">
</p>

**📖 Full article (canonical):** **[Return-of-Capital Adjustment — The Fintech Builder](https://thefintechbuilder.com/corporate-actions-and-security-master-data/complex-distributions/return-of-capital-adjustment/)**

This repository is the runnable, production-oriented companion to that article.
The article teaches the concept; this repo is the code you install and build on.

🧭 **Browse all algorithms:** [Awesome FinTech Algorithms](https://github.com/IslamBaraka90/Fintech-Algorithms-Awesome) — the full index of the library.
🗂️ **This algorithm's domain:** [Corporate Actions and Security Master Data](https://thefintechbuilder.com/domains/corporate-actions-and-security-master-data/) › **Complex Distributions**
📥 **Just want to call it?** It also ships in the [`fintech-algorithms`](https://www.npmjs.com/package/fintech-algorithms) npm package — see [Two ways to use this](#two-ways-to-use-this).

| | |
|---|---|
| **Catalog topic** | `D02-F02-A05` |
| **Domain** | D02 — Corporate Actions and Security Master Data |
| **Family** | D02-F02 — Complex Distributions |
| **Difficulty** | 4 / 5 |
| **Languages** | Python, TypeScript |
| **Completes** | the D02-F02 Complex Distributions family |

---

> **Not tax advice.** The US federal illustration is scoped to one jurisdiction and one year,
> requires USD, and is labelled an *illustration* throughout. The theoretical ex price is a
> methodology number, not a trade — `theoreticalPriceIsObservedTrade` is `false` in every
> result.

---

## Table of contents

- [Three views, kept apart](#three-views-kept-apart)
- [Gross, not net](#gross-not-net)
- [Decimal strings, not floats](#decimal-strings-not-floats)
- [Two ways to use this](#two-ways-to-use-this)
- [Install](#install)
- [Quickstart](#quickstart)
- [Worked example (exact)](#worked-example-exact)
- [Views: the analysis surface](#views-the-analysis-surface)
- [Input shape](#input-shape)
- [API reference](#api-reference)
- [Edge cases & limitations](#edge-cases--limitations)
- [Testing](#testing)
- [Related algorithms](#related-algorithms)
- [License](#license)

---

## Three views, kept apart

```
MARKET DATA — what the price series needs
  reference price:        25.00000000
  gross distribution:      2.00000000
  theoretical ex price:   23.00000000
  backward factor:         0.92000000
INVESTOR RETURNS — how a holder did
  price alone:            -7.400%
  gross total:            +0.600%
  net of cash:            +0.120%
US TAX ILLUSTRATION — what happens to cost basis
  basis reduction:         1.20000000
  basis after:             0.30000000
  excess over basis:       0.00000000
```

A 7.4% "fall" that is mostly cash the holder received. Three defensible numbers, and none of
them is a substitute for another — which is the whole design. Blending them is the classic
error, in both directions:

- Adjusting the **price series** by the net-of-withholding amount.
- Treating the **whole distribution** as a basis reduction when the issuer only classified
  part of it as return of capital. (Here: 2.00 distributed, **1.20** classified.)

---

## Gross, not net

```
gross distribution:        2.00000000
net of withholding + fees: 1.88000000
correct theoretical price: 23.00000000   factor 0.92000000
wrong theoretical price:   23.12000000   factor 0.92480000
price overstated by:       0.12000000   (+0.522% of the price)
```

The gross amount is what **left the company**. The net amount is what *one holder* received
after their withholding and fees — so a price series adjusted by it is specific to one
investor's tax position, and wrong for everybody else, including them next year.

`adjustment_basis_comparison` prices that mistake rather than warning about it.

---

## Decimal strings, not floats

Every monetary value is a plain decimal string, in and out. A monetary amount that survives a
round trip through a double is a *different amount*, and the whole point of this module is
that three separately-reported views agree to the cent.

Internally the arithmetic is **exact rational**, rounding **once** — half away from zero, to
eight decimals — at the very end. TypeScript uses a `BigInt` `Rational`; Python uses
`Fraction`. Both parse the same decimal spellings, so every published string matches to the
last digit.

Two consequences worth knowing:

- **Exponent notation is refused.** `"2e0"` is not a *plain* decimal, and accepting it would
  blur the published precision.
- **More than eight decimal places raises.** Silently truncating a ninth would be worse than
  saying so.

That is also why `verify_views` can check **exact equalities** rather than tolerance
comparisons.

---

## Two ways to use this

**📥 The fast path — one call, TypeScript only:**

```bash
npm install fintech-algorithms
```

```ts
import { calculate } from "fintech-algorithms/corporate-actions-and-security-master-data/complex-distributions/return-of-capital-adjustment";
```

That package is the breadth option: 324 algorithms, one install, the tutorial-level kernel
for each.

**🔬 This repo — the depth option.** Python *and* TypeScript, the `views` surface (identity
checks, the gross-versus-net comparison, bidirectional series adjustment, the basis runway),
an exact `BigInt` rational for the TypeScript side, and 234 tests pinning both languages to
one shared fixture.

---

## Install

**Python** (3.10+, no dependencies):

```bash
git clone https://github.com/IslamBaraka90/Fintech-Return-Of-Capital-Adjustment-Corporate-Actions-algorithm.git
cd Fintech-Return-Of-Capital-Adjustment-Corporate-Actions-algorithm/python
pip install -e ".[dev]"
```

**TypeScript** (Node 20+, no runtime dependencies):

```bash
cd Fintech-Return-Of-Capital-Adjustment-Corporate-Actions-algorithm/typescript
npm install
npm run build
```

---

## Quickstart

**Python**

```python
from fintech_return_of_capital import calculate, verify_views

result = calculate({
    "asOf": "2025-02-03T21:05:00Z",           # a knowledge time, not the event date
    "revisions": [{
        "eventId": "SYN-ROC-2025-001",
        "revisionId": "SYN-ANNOUNCEMENT-R1",
        "revisionSequence": 1,
        "observedAt": "2025-01-20T14:00:00Z",
        "availableAt": "2025-01-20T14:02:00Z",
        "sourceId": "SYN-ISSUER-NOTICE",
        "status": "confirmed",
        "exAt": "2025-02-03T14:30:00Z",
        "sameDayOrdering": {"sequence": 1, "priorEventIds": []},
        "terms": {
            "eventCurrency": "USD",
            "grossCapitalReturnPerShare": "2.00000000",
            "withholdingPerShare": "0.10000000",
            "feesPerShare": "0.02000000",
        },
    }],
    "referenceObservation": {
        "price": "25.00000000", "currency": "USD",
        "observedAt": "2025-01-31T21:00:00Z",
        "availableAt": "2025-01-31T21:00:05Z",
        "sourceId": "SYN-OFFICIAL-CLOSE",
    },
    "fxObservation": {
        "priceCurrencyPerEventCurrency": "1.00000000", "pair": "USD/USD",
        "anchorPolicy": "ON_OR_BEFORE_REFERENCE_OBSERVATION",
        "observedAt": "2025-01-31T21:00:00Z",
        "availableAt": "2025-01-31T21:00:00Z",
        "sourceId": "IDENTITY-FX",
    },
})

print(result["marketDataAdjustment"]["theoreticalExPrice"])   # 23.00000000
print(verify_views(result)["ok"])                             # True
```

**TypeScript**

```ts
import { calculate, verifyViews } from "fintech-return-of-capital";

const result = calculate({ asOf: "2025-02-03T21:05:00Z", revisions: [...], ... });
```

---

## Worked example (exact)

A 2.00 USD capital return against a 25.00 close, with 0.10 withholding and 0.02 fees, an
observed ex close of 23.15, and a US tax illustration against a 1.50 basis. Asserted verbatim
by both test suites.

| Market data | |
|---|---|
| Reference price | `25.00000000` |
| Gross distribution | `2.00000000` |
| **Theoretical ex price** | **`23.00000000`** |
| Backward history factor | `0.92000000` |
| Forward post-event factor | `1.08695652` |

| Investor returns | |
|---|---|
| Raw price return | `-0.07400000` |
| Gross total return | `0.00600000` |
| Net cash return | `0.00120000` |

| US federal tax illustration | |
|---|---|
| Basis reduction | `1.20000000` *(the issuer classified 1.20 of the 2.00)* |
| Basis after | `0.30000000` |
| Excess over basis | `0.00000000` |

---

## Views: the analysis surface

This is the surface that does not fit in a tutorial, and the reason to install the repo
rather than copy the snippet.

### `verify_views` — do the numbers close?

`reference - gross == theoretical` exactly; the factor is the price ratio and the forward
factor is its reciprocal (checked at the published eight-decimal precision, since both are
rounded before you see them); the tax legs are non-negative and the basis never goes
negative; **having basis left is mutually exclusive with having exceeded it**; and gross
total return ≥ net cash return ≥ raw price return.

### `adjustment_basis_comparison` — the gross-versus-net error, priced

Covered above. It reads the terms from the revision the calculation **actually selected**,
because reading them from the wrong one would misreport the gap.

### `adjust_price_series` — backward *and* forward

```
raw price      backward       forward
 25.00000000    23.00000000    27.17391300
 24.00000000    22.08000000    26.08695648
```

Backward restates history onto the post-event basis, which is what a continuous return series
needs. Forward carries prices back onto the pre-event basis, which is what a cost basis or a
filed figure needs. A return of capital is one of the few events where people genuinely want
both, so both factors are published.

Note the forward figures are computed from the **rounded** forward factor, so the round trip
is not bit-exact — 25 → 23 → 27.17 rather than back to 25. That is the cost of publishing a
fixed-precision factor, and it is visible rather than hidden.

### `basis_runway` — when the basis runs out

```
payment      reduction        excess     basis after
1.20000000       1.20000000    0.00000000      0.30000000
0.50000000       0.30000000    0.20000000      0.00000000
0.30000000       0.00000000    0.30000000      0.00000000
```

Basis falls until there is none, and everything after that is a **gain** rather than a
further reduction. That crossover is a taxable event nobody puts in a calendar, and it
arrives on whichever payment happens to cross it — here, the second.

Deliberately independent of `calculate`: the amounts are what the issuer *classified* as
return of capital, which is not what it distributed, and stringing several events together is
exactly where that distinction bites.

---

## Input shape

| Field | Meaning |
|---|---|
| `asOf` | ISO 8601 instant with an explicit UTC offset — the **knowledge time** |
| `revisions` | Non-empty, one `eventId`, unique `(revisionId, revisionSequence)`, each with `observedAt <= availableAt` |
| `referenceObservation` | Must be observed **strictly before** `exAt` |
| `fxObservation` | Required; identity rate for a same-currency event, and observed **no later than** the reference |
| `exObservation` | Optional; adds the return diagnostics, observed at or after `exAt` |
| `taxIllustration` | Optional; USD only, scoped to `US_FEDERAL_INDIVIDUAL_TAXABLE_2025` |

`sameDayOrdering` carries a `sequence` and the `priorEventIds` of every earlier action that
day, and the two must agree: a reference price that does not know what already moved it today
is not a reference price.

Timestamps must carry an explicit UTC offset; a naive one is refused. Calendars are checked
against real month lengths including the 400-year leap rule.

---

## API reference

| Python | TypeScript | Purpose |
|---|---|---|
| `calculate(payload)` | `calculate(...)` | The three views |
| `verify_views(result)` | `verifyViews(...)` | Every identity, exactly |
| `adjustment_basis_comparison(data)` | `adjustmentBasisComparison(...)` | Gross versus net, priced |
| `adjust_price_series(result, prices)` | `adjustPriceSeries(...)` | Backward and forward |
| `basis_runway(basis, amounts)` | `basisRunway(...)` | When the basis runs out |
| `select_revision(revisions, asOf)` | `selectRevision(...)` | Point-in-time selection |
| `parse_decimal(text, name)` | `parseDecimal(...)` | Decimal string → exact rational |
| `render(value)` | `render(...)` | Exact rational → eight-decimal string |

---

## Edge cases & limitations

- **Not tax advice**, and the illustration covers one jurisdiction and one year.
- **The classified amount is an issuer fact**, supplied as input. This module does not infer
  what portion of a distribution is return of capital.
- **A cancelled revision is a complete answer**, not an error: `state: "cancelled"`,
  `applied: false`, and no adjustment block.
- **One FX anchor policy.** `ON_OR_BEFORE_REFERENCE_OBSERVATION` is the only one implemented,
  and anything else is refused rather than approximated.
- **The forward round trip is not bit-exact**, because the forward factor is published at
  eight decimals. Documented above rather than hidden.
- **Deductions cannot exceed the distribution**, and the distribution cannot exceed the price.
- **The analysis surface refuses a cancelled result** rather than half-answering it.

---

## Testing

```bash
cd python && pytest -q          # 117 tests
cd typescript && npm test       # 117 tests
```

Both suites read the **same** `fixtures.json` and assert its exact expected output in each
language.

The suites also pin the behaviours most likely to drift: floats being refused as amounts,
exponent notation being refused, a ninth decimal place raising, a reference observed at the ex
instant being refused, an FX rate observed after the reference, the same-day ordering
consistency rule, the 400-year leap rule, and — as positive controls — a tampered theoretical
price, factor, forward factor, net return and basis each being caught.

---

## Related algorithms

**Same family — D02-F02 Complex Distributions**

- **[Special Dividend Adjustment](https://github.com/IslamBaraka90/Fintech-Special-Dividend-Adjustment-Corporate-Actions-algorithm)** — the other payment whose treatment turns on a classification.
- **[Spin-Off Price Adjustment](https://github.com/IslamBaraka90/Fintech-Spin-Off-Price-Adjustment-Corporate-Actions-algorithm)** · **[Stock Dividend Adjustment](https://github.com/IslamBaraka90/Fintech-Stock-Dividend-Adjustment-Corporate-Actions-algorithm)** · **[Rights Issue TERP Adjustment](https://github.com/IslamBaraka90/Fintech-Rights-Issue-TERP-Adjustment-Corporate-Actions-algorithm)**

**Related — D02-F01 Adjustment Factors**

- **[Cash-Dividend Total-Return Adjustment](https://github.com/IslamBaraka90/Fintech-Cash-Dividend-Total-Return-Adjustment-Corporate-Actions-algorithm)** — the ordinary income case, where basis is untouched.

🧭 **[Browse all algorithms →](https://github.com/IslamBaraka90/Fintech-Algorithms-Awesome)**

---

## License

MIT — see [LICENSE](LICENSE).

The synthetic fixture data is CC0-1.0. No market data is redistributed.
