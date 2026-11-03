// All money is integer minor units (paise for INR). No floating point is
// used for any amount: parsing and formatting work on digit strings.

export const MAX_MINOR = 999_999_999; // same ceiling as the database check

/** Decimal places a currency uses: INR 2, JPY 0, KWD 3. From the platform's own ISO 4217 data. */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/**
 * "340", "1,200.50", "₹ 340", "Rs.99" -> minor units. Returns null for
 * anything that isn't a clean positive amount within the ceiling, or that has
 * more decimals than the currency allows (refused, never rounded).
 */
export function parseAmount(input: string, currency: string): number | null {
  const s = input.trim().replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/[\s,]/g, "");
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const digits = currencyDigits(currency);
  const frac = m[2] ?? "";
  if (frac.length > digits) return null;
  const whole = m[1].replace(/^0+(?=\d)/, "");
  if (whole.length > 12) return null;
  const minor = Number(whole + frac.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_MINOR) return null;
  return minor;
}

/** Minor units -> "₹1,23,456.78". en-IN grouping for every currency. */
export function formatMoney(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new Error("minor must be an integer");
  const digits = currencyDigits(currency);
  const neg = minor < 0;
  const abs = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = digits ? abs.slice(0, -digits) : abs;
  const frac = digits ? abs.slice(-digits) : "";
  const f = new Intl.NumberFormat("en-IN", {
    style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  // Intl accepts a decimal string, so no float is ever created.
  const text = f.format((frac ? `${whole}.${frac}` : whole) as unknown as number);
  return neg ? `−${text}` : text;
}
