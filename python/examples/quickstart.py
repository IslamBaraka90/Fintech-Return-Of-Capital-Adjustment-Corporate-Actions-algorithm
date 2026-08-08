"""Three views of one payment, and what happens when they get blended.

Run:  python examples/quickstart.py
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fintech_return_of_capital import (  # noqa: E402
    adjust_price_series,
    adjustment_basis_comparison,
    basis_runway,
    calculate,
    verify_views,
)

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "fixtures.json")
    .read_text(encoding="utf-8")
)
REQUEST = FIXTURE["input"]


def rule(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


def pct(text: str, digits: int = 3) -> str:
    from fractions import Fraction

    return f"{float(Fraction(text)) * 100:+.{digits}f}%"


result = calculate(REQUEST)

# --- 1. three views, kept apart ---------------------------------------------------- #
rule("1. One payment, three separate answers")

market = result["marketDataAdjustment"]
returns = result["investorReturnDiagnostics"]
tax = result["usFederalTaxIllustration"]

print("  MARKET DATA — what the price series needs")
print(f"    reference price:        {market['referencePrice']}")
print(f"    gross distribution:     {market['grossDistributionInPriceCurrency']}")
print(f"    theoretical ex price:   {market['theoreticalExPrice']}")
print(f"    backward factor:        {market['backwardHistoryFactor']}")
print("  INVESTOR RETURNS — how a holder did")
print(f"    price alone:            {pct(returns['rawPriceReturn'])}")
print(f"    gross total:            {pct(returns['grossTotalReturn'])}")
print(f"    net of cash:            {pct(returns['netCashReturn'])}")
print("  US TAX ILLUSTRATION — what happens to cost basis")
print(f"    basis reduction:        {tax['basisReductionPerShare']}")
print(f"    basis after:            {tax['basisPerShareAfter']}")
print(f"    excess over basis:      {tax['excessOverBasisPerShare']}")
print("  A 7.4% 'fall' that is mostly cash the holder received. Three defensible")
print("  numbers, and none of them is a substitute for another.")

# --- 2. gross, not net -------------------------------------------------------------- #
rule("2. The classic error: adjusting by the net cash")

comparison = adjustment_basis_comparison(REQUEST)
print(f"  gross distribution:        {comparison['grossDistribution']}")
print(f"  net of withholding + fees: {comparison['netDistribution']}")
print(f"  correct theoretical price: {comparison['correctTheoreticalExPrice']}"
      f"   factor {comparison['correctBackwardFactor']}")
print(f"  wrong theoretical price:   {comparison['wrongTheoreticalExPrice']}"
      f"   factor {comparison['wrongBackwardFactor']}")
print(f"  price overstated by:       {comparison['priceOverstatedBy']}"
      f"   ({pct(comparison['relativeError'])} of the price)")
print(f"  correct basis: {comparison['correctBasis']}")
print("  The gross amount is what left the company. The net amount is what ONE holder")
print("  received after their withholding and fees — so a series adjusted by it is")
print("  specific to one investor's tax position, and wrong for everybody else.")

# --- 3. every identity closes --------------------------------------------------------- #
rule("3. The numbers check out, exactly")

check = verify_views(result)
print(f"  reference - gross == theoretical:  {check['priceCloses']}")
print(f"  factor is the price ratio:         {check['factorMatchesPriceRatio']}")
print(f"  forward is the reciprocal:         {check['factorsAreReciprocal']}")
print(f"  return ordering holds:             {not check['returnBreaks']}")
print(f"  tax legs are consistent:           {not check['taxBreaks']}")
print(f"  theoretical price is a trade:      {check['theoreticalPriceIsObservedTrade']}")

broken = copy.deepcopy(result)
broken["marketDataAdjustment"]["theoreticalExPrice"] = "24.00000000"
print(f"  with the ex price nudged to 24.00: ok={verify_views(broken)['ok']}")
print("  These are exact equalities, not tolerance comparisons. Every amount is a")
print("  decimal string, parsed to an exact rational, rounded once at the end.")

# --- 4. adjust the history, either way -------------------------------------------------- #
rule("4. Backward for a return series, forward for a cost basis")

series = adjust_price_series(result, ["25.00000000", "24.00000000", "20.00000000"])
print("  raw price      backward       forward")
for row in series["rows"]:
    print(f"  {row['rawPrice']:>12} {row['backwardAdjusted']:>14} {row['forwardAdjusted']:>14}")
print(f"  raw ex-date step: {pct(series['rawExDateStep'], 2)}"
      f"   adjusted: {pct(series['adjustedExDateStep'], 2)}")
print("  Backward restates history onto the post-event basis, which is what a continuous")
print("  return series needs. Forward carries prices back onto the pre-event basis, which")
print("  is what a cost basis needs. A return of capital genuinely needs both.")

# --- 5. the basis runs out ---------------------------------------------------------------- #
rule("5. When the basis runs out, the payments become gains")

ladder = basis_runway("1.50000000", ["1.20000000", "0.50000000", "0.30000000"])
print(f"  starting basis: {ladder['basisBefore']}")
print("  payment      reduction        excess     basis after")
for row in ladder["rows"]:
    print(f"  {row['classifiedAmount']:>10} {row['basisReduction']:>16}"
          f" {row['excessOverBasis']:>13} {row['basisAfter']:>15}")
print(f"  basis exhausted on payment index: {ladder['exhaustedAtIndex']}")
print(f"  total reduction: {ladder['totalBasisReduction']}"
      f"   total gain: {ladder['totalExcessOverBasis']}")
print("  Basis falls until there is none, and everything after that is a GAIN rather")
print("  than a further reduction. That crossover is a taxable event nobody schedules,")
print("  arriving on whichever payment happens to cross it.")
