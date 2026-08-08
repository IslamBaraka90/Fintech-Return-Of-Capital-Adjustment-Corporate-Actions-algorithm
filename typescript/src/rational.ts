/**
 * An exact rational, built from a number's **decimal spelling** rather than its binary value.
 *
 * This is the JavaScript counterpart of Python's `fractions.Fraction`, and it exists for one
 * reason: `Fraction(str(1.1))` is exactly `11/10` while `Fraction(1.1)` is the binary
 * approximation. Doing the whole special-dividend calculation on exact rationals — and
 * rounding only at the very end — is what lets Python and TypeScript share one
 * round-half-away policy instead of each accumulating its own floating-point error.
 *
 * Both languages take the *shortest round-trip decimal* of a double (`str` in Python,
 * `String` in JavaScript), so the two start from the same rational and stay there.
 */

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right) {
    [left, right] = [right, left % right];
  }
  return left;
}

/** An exact rational number. Always stored in lowest terms with a positive denominator. */
export class Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;

  constructor(numerator: bigint, denominator: bigint = 1n) {
    if (denominator === 0n) throw new RangeError("denominator must not be zero");
    let top = numerator;
    let bottom = denominator;
    if (bottom < 0n) {
      top = -top;
      bottom = -bottom;
    }
    const divisor = gcd(top, bottom) || 1n;
    this.numerator = top / divisor;
    this.denominator = bottom / divisor;
  }

  /**
   * Parse a decimal spelling — `"1.1"`, `"-0.25"`, `"1e-3"` — into an exact rational.
   *
   * Exponent notation is handled because `String(1e-7)` is `"1e-7"` in JavaScript, and a
   * parser that only understood plain decimals would silently mis-read small numbers.
   */
  static fromDecimalString(text: string): Rational {
    const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
    if (match === null || (!match[2] && !match[3])) {
      throw new RangeError(`cannot parse ${text} as a decimal`);
    }
    const sign = match[1] === "-" ? -1n : 1n;
    const whole = match[2] || "0";
    const fraction = match[3] || "";
    const exponent = Number(match[4] ?? 0);

    let numerator = sign * BigInt(whole + fraction);
    let denominator = 10n ** BigInt(fraction.length);
    if (exponent > 0) numerator *= 10n ** BigInt(exponent);
    else if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
    return new Rational(numerator, denominator);
  }

  /** The exact rational of a JavaScript number, via its shortest round-trip decimal. */
  static fromNumber(value: number): Rational {
    if (!Number.isFinite(value)) throw new RangeError("value must be finite");
    return Rational.fromDecimalString(String(value));
  }

  static of(value: bigint | number): Rational {
    return typeof value === "bigint" ? new Rational(value) : Rational.fromNumber(value);
  }

  add(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  subtract(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator - other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  multiply(other: Rational): Rational {
    return new Rational(
      this.numerator * other.numerator, this.denominator * other.denominator,
    );
  }

  divide(other: Rational): Rational {
    if (other.numerator === 0n) throw new RangeError("division by zero");
    return new Rational(
      this.numerator * other.denominator, this.denominator * other.numerator,
    );
  }

  /** `-1`, `0` or `1`. Exact, with no floating-point step anywhere. */
  compare(other: Rational): number {
    const left = this.numerator * other.denominator;
    const right = other.numerator * this.denominator;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  equals(other: Rational): boolean {
    return this.compare(other) === 0;
  }

  abs(): Rational {
    return this.numerator < 0n ? new Rational(-this.numerator, this.denominator) : this;
  }

  get sign(): number {
    return this.numerator < 0n ? -1 : this.numerator > 0n ? 1 : 0;
  }
}

export const ZERO = new Rational(0n);
export const ONE = new Rational(1n);

/**
 * Round an exact rational half away from zero, then render the shortest decimal.
 *
 * Mirrors the Python implementation exactly, including stripping trailing zeros so
 * `6.60000000` serializes as `6.6` and an integral result collapses to an integer — which is
 * what keeps the two languages byte-identical.
 */
export function roundHalfAway(value: Rational, decimals: number): number {
  const scale = 10n ** BigInt(decimals);
  const numerator = (value.numerator < 0n ? -value.numerator : value.numerator) * scale;
  let whole = numerator / value.denominator;
  if ((numerator % value.denominator) * 2n >= value.denominator) whole += 1n;
  if (value.numerator < 0n) whole = -whole;

  if (decimals === 0) return Number(whole);
  const sign = whole < 0n ? "-" : "";
  const digits = (whole < 0n ? -whole : whole).toString().padStart(decimals + 1, "0");
  const rendered = `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const result = Number(rendered);
  // Collapse -0 so the two languages serialize identically.
  return result === 0 ? 0 : result;
}
