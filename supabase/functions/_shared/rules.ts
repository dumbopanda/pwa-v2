// Plain-code quick-log reader. Free, instant, offline, private: nothing leaves
// the device. It handles the common shapes ("swiggy 340 upi", "kal chai 20
// cash", bank SMS). When it isn't sure, the app asks the AI instead.
import { currencyDigits, MAX_MINOR } from "./money.ts";
import { redactSms, type ParseInput, type Proposal } from "./parse.ts";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const words = (s: string) => norm(s).split(/[^a-z0-9&]+/).filter(Boolean);

// ---- amounts ----
const UNITS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9, das: 10,
  bees: 20, tees: 30, chalis: 40, pachaas: 50, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
};
const MULT: Record<string, number> = { sau: 100, so: 100, hazaar: 1000, hazar: 1000, hajar: 1000, thousand: 1000, k: 1000, lakh: 100000, lac: 100000, lakhs: 100000 };
const FRACT: Record<string, number> = { dedh: 1.5, dhai: 2.5, adhai: 2.5 };

/** Decimal string -> integer minor units, by digits only (no float maths). */
function toMinor(decimal: string, currency: string): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimal.replace(/,/g, ""));
  if (!m) return null;
  const d = currencyDigits(currency);
  const frac = (m[2] ?? "").slice(0, d).padEnd(d, "0");
  if ((m[2] ?? "").length > d && /[1-9]/.test((m[2] ?? "").slice(d))) return null;
  const v = Number(m[1] + frac);
  return Number.isSafeInteger(v) && v > 0 && v <= MAX_MINOR ? v : null;
}
/** "1.5" * 1000 as a decimal string, without floats: shift the decimal point. */
function scale(decimal: string, mult: number): string {
  const zeros = String(mult).length - 1;               // mult is a power of ten
  const [w, f = ""] = decimal.replace(/,/g, "").split(".");
  const digits = w + f.padEnd(zeros, "0");
  const whole = digits.slice(0, w.length + zeros).replace(/^0+(?=\d)/, "");
  const rest = digits.slice(w.length + zeros);
  return rest && /[1-9]/.test(rest) ? `${whole}.${rest}` : whole;
}
/** Hindi number words: "paanch sau" 500, "dedh sau" 150, "saadhe teen sau" 350, "do hazaar" 2000. */
function hindiNumber(ws: string[]): { value: string; used: Set<number> } | null {
  for (let i = 0; i < ws.length; i++) {
    let base: number | null = null; let j = i;
    if (ws[j] === "saadhe" || ws[j] === "sadhe") { const u = UNITS[ws[j + 1]]; if (u) { base = u + 0.5; j += 2; } }
    else if (ws[j] === "sawa") { const u = UNITS[ws[j + 1]]; if (u) { base = u + 0.25; j += 2; } }
    else if (FRACT[ws[j]]) { base = FRACT[ws[j]]; j += 1; }
    else if (UNITS[ws[j]] && MULT[ws[j + 1]] && ws[j + 1] !== "k") { base = UNITS[ws[j]]; j += 1; }
    else if ((ws[j] === "sau" || ws[j] === "hazaar") && i === j) { base = 1; }
    if (base === null) continue;
    const mult = MULT[ws[j]];
    if (!mult || ws[j] === "k" || ws[j] === "so") continue;
    const used = new Set<number>(); for (let k = i; k <= j; k++) used.add(k);
    // base is a multiple of 0.25 and mult >= 100, so this product is a whole number.
    return { value: String(Math.round(base * mult)), used };
  }
  return null;
}

const CUR: [RegExp, string][] = [
  [/\$|\busd\b|\bdollars?\b/i, "USD"], [/€|\beur\b|\beuros?\b/i, "EUR"], [/£|\bgbp\b|\bpounds?\b/i, "GBP"],
  [/\baed\b|\bdirhams?\b/i, "AED"], [/\bsgd\b/i, "SGD"], [/¥|\bjpy\b|\byen\b/i, "JPY"],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? t.toISOString().slice(0, 10) : null;
};

/** Finds a date in the text. Returns it and the text with the date words removed. */
function findDate(text: string, today: string): { date: string | null; rest: string } {
  const y = Number(today.slice(0, 4));
  const past = (dt: string | null) => (dt && dt > today ? (dt.slice(0, 4) === String(y) ? iso(y - 1, Number(dt.slice(5, 7)), Number(dt.slice(8))) : null) : dt);
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(text))) {
    const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { date: past(iso(yy, Number(m[2]), Number(m[1]))), rest: text.replace(m[0], " ") };
  }
  if ((m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*(${MONTHS.join("|")})[a-z]*\\b`, "i").exec(text))
    || (m = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*[\\s-]*(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i").exec(text))) {
    const day = /\d/.test(m[1]) ? Number(m[1]) : Number(m[2]);
    const mon = MONTHS.indexOf((/\d/.test(m[1]) ? m[2] : m[1]).toLowerCase().slice(0, 3)) + 1;
    return { date: past(iso(y, mon, day)), rest: text.replace(m[0], " ") };
  }
  if ((m = /\b(day before yesterday|parso|parson)\b/i.exec(text))) return { date: addDays(today, -2), rest: text.replace(m[0], " ") };
  if ((m = /\b(yesterday|kal|yday)\b/i.exec(text))) return { date: addDays(today, -1), rest: text.replace(m[0], " ") };
  if ((m = /\b(today|aaj)\b/i.exec(text))) return { date: today, rest: text.replace(m[0], " ") };
  if ((m = new RegExp(`\\b(last\\s+)?(${DAYS.join("|")})\\b`, "i").exec(text))) {
    const [yy, mm, dd] = today.split("-").map(Number);
    const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay(), want = DAYS.indexOf(m[2].toLowerCase());
    let back = (dow - want + 7) % 7; if (back === 0 && m[1]) back = 7;
    return { date: addDays(today, -back), rest: text.replace(m[0], " ") };
  }
  return { date: null, rest: text };
}

// ---- accounts ----
const GENERIC = new Set(["account", "acct", "bank", "my", "the", "a/c", "wallet"]);
function findAccount(ws: string[], text: string, accounts: string[]): { name: string | null; used: Set<string> } {
  const t = ` ${norm(text)} `;
  const scored = accounts.map((a) => {
    const n = norm(a); let s = 0; const used = new Set<string>();
    if (t.includes(` ${n} `)) { s = 3; n.split(" ").forEach((w) => used.add(w)); }
    for (const w of n.split(" ")) if (!GENERIC.has(w) && w.length >= 2 && ws.includes(w) && !(w === "us" && !t.includes(" us account"))) { s = Math.max(s, 2); used.add(w); }
    if (/card|credit/.test(n) && ws.some((w) => w === "card" || w === "cc")) { s = Math.max(s, 2); ws.filter((w) => w === "card" || w === "cc").forEach((w) => used.add(w)); }
    if (/upi/.test(n) && ws.some((w) => ["gpay", "phonepe", "paytm", "upi"].includes(w))) { s = Math.max(s, 2); ws.filter((w) => ["gpay", "phonepe", "paytm", "upi"].includes(w)).forEach((w) => used.add(w)); }
    return { a, s, used };
  }).filter((x) => x.s > 0).sort((p, q) => q.s - p.s);
  if (!scored.length || (scored[1] && scored[1].s === scored[0].s)) return { name: null, used: new Set() };
  return { name: scored[0].a, used: scored[0].used };
}

// ---- categories ----
// Keyword hints for the default category names. Used only when the user has a
// category whose name starts with the key; the user's own history wins first.
const HINTS: [string, string[]][] = [
  ["refund", ["refund", "refunded", "reversal", "returned"]],
  ["salary", ["salary", "payroll", "wages"]],
  ["other income", ["cashback", "interest", "dividend", "bonus"]],
  ["subscriptions", ["netflix", "spotify", "prime", "hotstar", "youtube", "subscription", "icloud", "chatgpt"]],
  ["fuel", ["petrol", "diesel", "fuel", "cng"]],
  ["groceries", ["grocery", "groceries", "bigbasket", "blinkit", "zepto", "dmart", "milk", "doodh", "sabzi", "vegetables", "fruits", "kirana", "instamart", "eggs", "bread"]],
  ["food", ["swiggy", "zomato", "chai", "tea", "coffee", "lunch", "dinner", "breakfast", "snacks", "samosa", "restaurant", "cafe", "pizza", "biryani", "burger", "dominos", "kfc", "mcdonalds", "starbucks", "juice", "meal", "food", "nashta", "brunch", "supper", "thali", "dosa", "momos"]],
  ["transport", ["uber", "ola", "rapido", "auto", "cab", "taxi", "metro", "bus", "parking", "toll", "rickshaw"]],
  ["bills", ["electricity", "bill", "recharge", "jio", "airtel", "wifi", "broadband", "internet", "gas", "water", "dth", "postpaid"]],
  ["rent", ["rent", "kiraya"]],
  ["health", ["medicine", "medicines", "dawai", "pharmacy", "doctor", "dentist", "hospital", "apollo", "1mg", "pharmeasy", "clinic", "chemist"]],
  ["education", ["fees", "course", "books", "tuition", "udemy", "school", "college"]],
  ["entertainment", ["movie", "movies", "pvr", "inox", "concert", "bookmyshow", "game"]],
  ["travel", ["flight", "hotel", "irctc", "trip", "makemytrip", "goibibo", "oyo", "airbnb"]],
  ["personal care", ["haircut", "salon", "spa", "parlour", "barber"]],
  ["shopping", ["amazon", "flipkart", "myntra", "ajio", "meesho", "shoes", "clothes", "shirt", "mall", "shopping", "bought"]],
  ["gifts", ["gift", "donation", "charity"]],
];
const INCOME = new Set(["refund", "salary", "other income"]);

function findCategory(ws: string[], direction: Proposal["direction"], categories: string[], history?: Map<string, string>): string | null {
  if (history) for (const w of ws) { const h = history.get(w); if (h && categories.includes(h)) return h; }
  for (const [key, kws] of HINTS) {
    if (INCOME.has(key) !== (direction === "received")) continue;
    if (!kws.some((k) => ws.includes(k))) continue;
    const c = categories.find((x) => norm(x).startsWith(key));
    if (c) return c;
  }
  return null;
}

const FILLER = new Set(["rs", "inr", "rupaye", "rupay", "rupees", "rupee", "ka", "ki", "ke", "pe", "par", "se", "mein", "me", "to", "from", "via", "using", "on", "for", "at",
  "paid", "spent", "spend", "around", "approx", "approximately", "lagbhag", "about", "got", "received", "credited", "debited", "aaya", "aaye", "mila", "mile",
  "bheje", "diye", "diya", "kiya", "liye", "liya", "the", "a", "an", "of", "and", "my", "rupaiya", "kharcha", "kharch", "bhara", "your", "with", "by", "is", "was"]);

export type RuleResult = Proposal & { sure: boolean };

/** Read one quick-log message with plain code. `history` maps a lower-case word (a past name) to its category. */
export function parseRules(input: ParseInput, history?: Map<string, string>): RuleResult {
  const raw = redactSms(input.text).replace(/\[[a-z ]+removed\]/g, " ");
  const sms = /\b(debited|credited|spent on|sent rs|vpa|a\/c|txn|upi ref)\b/i.test(input.text);
  const { date, rest } = findDate(raw, input.today);
  let text = rest;

  // currency
  let currency: string | null = null;
  for (const [re, c] of CUR) if (re.test(text)) { currency = c; break; }
  if (/(?:rs\.?|inr|₹)\s*\d/i.test(text)) currency = currency ?? null;

  // direction
  const t = norm(text);
  const ws0 = words(text);
  let direction: Proposal["direction"] = "spent";
  if (/\b(credited|received|refund|refunded|cashback|salary|bonus|reimburs\w*|interest|got|mila|mili|aaya|aaye)\b/.test(t)) direction = "received";
  if (/\bne\b.*\b(diye|diya|bheje|bheja)\b/.test(t)) direction = "received";
  if (/\b(debited|spent|paid)\b/.test(t) && !/\b(credited|refund)\b/.test(t)) direction = "spent";

  // amount: an explicit Rs/INR/₹ amount wins, then "12k / 1.5 lakh", then Hindi words, then a lone number.
  let amount: string | null = null; let candidates = 0; const usedIdx = new Set<number>();
  let m = /(?:rs\.?|inr|₹|\$|€|£)\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (m) { amount = m[1]; text = text.replace(m[0], " "); candidates = 1; }
  if (!amount && (m = /(\d+(?:\.\d+)?)\s*(k|lakhs?|lac|hazaar|hazar|thousand)\b/i.exec(text))) {
    const mult = MULT[m[2].toLowerCase()] ?? 1000;
    amount = scale(m[1], mult); text = text.replace(m[0], " "); candidates = 1;
  }
  if (!amount) {
    const h = hindiNumber(ws0);
    if (h) { amount = h.value; h.used.forEach((i) => usedIdx.add(i)); candidates = 1; }
  }
  if (!amount) {
    const nums = [...text.matchAll(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])/g)].map((x) => x[1]);
    candidates = nums.length;
    if (nums.length) { amount = nums.reduce((a, b) => (Number(b.replace(/,/g, "")) > Number(a.replace(/,/g, "")) ? b : a)); text = text.replace(amount, " "); }
  }
  const amount_minor = amount ? toMinor(amount, currency ?? "INR") : null;

  // accounts and transfers
  const ws = words(text).filter((_, i) => !usedIdx.has(i));
  let account: string | null = null, transfer_to: string | null = null; const accWords = new Set<string>();
  const nt = norm(text);
  const rev = /\b(?:moved?|transfer(?:red)?|shift(?:ed)?|sent|put)\b.*?\bto\s+(.+?)\s+from\s+(.+)$/i.exec(nt);   // "to X from Y"
  const tr = /\b(?:moved?|transfer(?:red)?|shift(?:ed)?|sent|put|paid)\b.*?\bfrom\s+(.+?)\s+to\s+(.+)$/i.exec(nt)
    ?? (rev ? [rev[0], rev[2], rev[1]] as unknown as RegExpExecArray : null)
    ?? /^(.+?)\s+se\s+(?:\S+\s+)?(.+?)\s+(?:mein|me|main)\b/i.exec(nt);
  if (tr) {
    const a = findAccount(words(tr[1]), tr[1], input.accounts), b = findAccount(words(tr[2]), tr[2], input.accounts);
    if (a.name && b.name && a.name !== b.name) { account = a.name; transfer_to = b.name; }
  }
  if (!transfer_to && /\b(card|credit card|cc)\s+bill\b/.test(norm(text)) && /\bfrom\b/.test(norm(text))) {
    const fromPart = norm(text).split(/\bfrom\b/)[1] ?? "";
    const a = findAccount(words(fromPart), fromPart, input.accounts);
    const card = input.accounts.find((x) => /card|credit/i.test(x));
    if (a.name && card && a.name !== card) { account = a.name; transfer_to = card; }
  }
  if (!transfer_to) { const f = findAccount(ws, text, input.accounts); account = f.name; f.used.forEach((w) => accWords.add(w)); }

  // name: SMS merchant first, else the words left over
  let name = "";
  const vpa = /\bvpa\s+([a-z0-9._-]+)@/i.exec(input.text) ?? /\bto\s+([a-z0-9._-]+)@/i.exec(input.text);
  const at = /\bat\s+([A-Za-z0-9&.' ]{2,40}?)(?=\s+on\b|\.|$)/.exec(input.text);
  const by = /\bby\s+([A-Za-z0-9&.' ]{2,40}?)(?=\.|\s+avl|\s+on\b|$)/i.exec(input.text);
  if (sms) name = (vpa?.[1] ?? at?.[1] ?? by?.[1] ?? "").trim().toLowerCase();
  if (!name) {
    const toName = /\b(?:paid|sent|gave)\s+to\s+([a-z0-9&.' ]{2,40}?)(?=\s+(?:on|via|from|for)\b|$)/i.exec(text);
    name = toName ? toName[1].trim() : words(text).filter((w, i) => !usedIdx.has(i) && !accWords.has(w) && !FILLER.has(w) && !/^\d/.test(w) && !/^(k|lakh|lac|usd|eur|euro|euros|dollars?|gbp|aed|jpy|yen|sgd|card|cc|upi|cash|bill)$/.test(w) || w === "bill").join(" ");
  }
  if (transfer_to) { name = "Self transfer"; direction = "spent"; }   // a move between your own accounts is neither
  const category = transfer_to ? null : findCategory(words(input.text), direction, input.categories, history);

  const vague = /\b(around|approx\w*|about|lagbhag|some|kuch)\b|~/i.test(input.text);
  const sure = amount_minor !== null && candidates <= 1 && !vague && !!name && (transfer_to !== null || category !== null);
  return {
    amount_minor, currency, account, transfer_to, category, name: name.slice(0, 120) || input.text.slice(0, 40),
    direction, date: date ?? input.today, note: null, confidence: sure ? 0.85 : amount_minor === null ? 0.2 : 0.5, sure,
  };
}
