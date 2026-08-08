"""Return of capital: a payment that is not income, and three views that must stay apart.

A return of capital hands cash back out of **capital rather than earnings**. The price falls
like any distribution, but the tax treatment is different: it reduces cost basis rather than
being taxed as income, and only the part exceeding basis becomes a gain.

So three views are kept separate and never blended — the market-data adjustment (which uses
the **gross** amount, because that is what left the company), the investor return
diagnostics, and a US federal tax illustration scoped to one jurisdiction and one year.

Every monetary value is a plain decimal string, in and out. No floats cross the interface.

Quickstart::

    from fintech_return_of_capital import calculate

    result = calculate({"asOf": "2025-02-03T21:05:00Z", "revisions": [...], ...})
    print(result["marketDataAdjustment"]["theoreticalExPrice"])

See :mod:`fintech_return_of_capital.core` for the calculation and
:mod:`fintech_return_of_capital.views` for the identity checks, the gross-versus-net
comparison, series adjustment and the basis runway.

Article: https://thefintechbuilder.com/corporate-actions-and-security-master-data/complex-distributions/return-of-capital-adjustment/
"""

from .core import (
    FX_ANCHOR_POLICY,
    OUTPUT_DECIMALS,
    STATUSES,
    US_TAX_SCOPE,
    calculate,
    parse_decimal,
    parse_instant,
    render,
    select_revision,
)
from .views import (
    adjust_price_series,
    adjustment_basis_comparison,
    basis_runway,
    verify_views,
)

__version__ = "0.1.0"

__all__ = [
    "FX_ANCHOR_POLICY",
    "OUTPUT_DECIMALS",
    "STATUSES",
    "US_TAX_SCOPE",
    "__version__",
    "adjust_price_series",
    "adjustment_basis_comparison",
    "basis_runway",
    "calculate",
    "parse_decimal",
    "parse_instant",
    "render",
    "select_revision",
    "verify_views",
]
