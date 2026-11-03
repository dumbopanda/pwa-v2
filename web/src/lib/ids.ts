const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const newUid = (): string => crypto.randomUUID();

/** `N` + 6 chars: a one-way entry. `Y` + 6: a transfer pair (no loan UI in v1). */
export function newTxnId(kind: "N" | "Y"): string {
  const out: string[] = [];
  const buf = new Uint8Array(1);
  while (out.length < 6) {
    crypto.getRandomValues(buf);
    if (buf[0] < 252) out.push(ALPHABET[buf[0] % 36]); // 252 = 7*36, no modulo bias
  }
  return kind + out.join("");
}

/** The device's local calendar date as YYYY-MM-DD. The server never decides "today". */
export function todayLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
