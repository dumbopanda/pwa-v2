import Icon from "../Icon";
import { useMemo, useRef, useState } from "react";
import { failMessage, historyMap, proposalToDraft, readEntry } from "../lib/ai";
import { firstSaveMs, logEvent, saveDraft, setNoSpend } from "../lib/actions";
import { Empty, Sheet, toast, useAction } from "../components";
import { checkDraft, draftFromEntry, emptyDraft, type Draft } from "../lib/entryRows";
import { dayLabel } from "../lib/format";
import { useLedger, useToday } from "../lib/hooks";
import { addDays, daysInMonth, dayState, isLogged, missedDays, monthOf, streak } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { monthLabel } from "../lib/reviewFacts";
import type { Entry } from "../lib/types";
import Detail from "./Detail";
import EntrySheet, { LAST_ACCOUNT } from "./EntrySheet";
import { buildLines, Lines } from "./EntryRow";

type Pending = { draft: Draft; hint?: string; assumed: boolean; via: "ai" | "sms"; source: "rules" | "ai" };

/** The month a review should be offered for: the last 3 days of a month, and the first 5 of the next. */
export function reviewMonth(today: string): string | null {
  const ym = monthOf(today), day = Number(today.slice(8));
  if (day >= daysInMonth(ym) - 2) return ym;
  if (day <= 5) return monthOf(addDays(`${ym}-01`, -1));
  return null;
}

export default function Today({ onReview, onSettings }: { onReview: (ym: string) => void; onSettings: () => void }) {
  const L = useLedger();
  const today = useToday();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [form, setForm] = useState<{ draft: Draft; existing?: Entry; via: "manual" | "ai" | "sms"; original?: Draft; hint?: string; source?: "rules" | "ai" } | null>(null);
  const [detail, setDetail] = useState<Entry | null>(null);
  const [sms, setSms] = useState<string | null>(null);
  const { busy, error, run, setError } = useAction();
  const lastAccount = () => { try { return localStorage.getItem(LAST_ACCOUNT); } catch { return null; } };

  const state = (d: string) => dayState(d, L.loggedDates, L.noSpend);
  const first = L.s.firstDay || today;
  const run_ = streak(today, state, first);
  const missed = useMemo(() => missedDays(today, state, first, 3), [today, L.loggedDates, L.noSpend, first]);  // eslint-disable-line react-hooks/exhaustive-deps
  const todays = L.entries.filter((e) => e.entry_date === today && isLogged(e));
  const lines = buildLines(todays, L.accountById, L.categoryById);
  const review = reviewMonth(today);

  // Today's running spend, per currency, never mixed.
  const spent = new Map<string, number>();
  for (const e of todays) if (e.direction === "debit" && !e.transfer_group && !e.txn_id.startsWith("Y")) {
    const c = L.accountById.get(e.account_id)?.currency ?? "INR"; spent.set(c, (spent.get(c) ?? 0) + e.amount_minor);
  }

  const noAccounts = L.activeAccounts.length === 0;
  const by_hand = (over?: Partial<Draft>) => setForm({ draft: { ...emptyDraft(today, lastAccount() ?? (L.activeAccounts.length === 1 ? L.activeAccounts[0].id : "")), ...over }, via: "manual" });

  async function read(raw: string, via: "ai" | "sms") {
    const t = raw.trim();
    if (!t) return;
    const r = await run(() => readEntry(t, L.activeAccounts, L.activeCategories, today, historyMap(L.entries, L.categories)));
    if (!r) return;
    if (!r.ok) { toast(failMessage(r.fail)); by_hand({ name: via === "ai" ? t.slice(0, 120) : "" }); setSms(null); return; }
    const x = proposalToDraft(r.proposal, L.activeAccounts, L.activeCategories, lastAccount(), today);
    setPending({ draft: x.draft, hint: r.note ?? x.hint, assumed: x.assumedAccount, via, source: r.source });
    setText(""); setSms(null);
  }

  async function confirm() {
    if (!pending) return;
    const c = checkDraft(pending.draft, L.activeAccounts, today);
    if (!c.ok) return setError(c.error);
    // One tap saves exactly what the card shows; the sheet path handles edits.
    const saved = await run(() => saveDraft(pending.draft, c.minor));
    if (!saved) return;
    try { localStorage.setItem(LAST_ACCOUNT, pending.draft.accountId); } catch { /* ignore */ }
    const ms = firstSaveMs();
    logEvent("entry_saved", { via: pending.via, ...(ms !== undefined ? { ms } : {}) });
    logEvent("ai_result", { outcome: "accepted", source: pending.source });
    toast("Saved"); setPending(null);
  }

  function reject() { logEvent("ai_result", { outcome: "rejected", source: pending?.source ?? "ai" }); setPending(null); setError(null); }

  const stat = state(today);
  const acc = (id: string) => L.accountById.get(id);
  const cardOk = pending ? checkDraft(pending.draft, L.activeAccounts, today) : null;

  return (
    <main className="screen stack" style={{ gap: "var(--sp-4)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>Today</h1><div className="muted">{dayLabel(today)}</div></div>
        <div className="row">
          {run_ > 0 && <span className="statuschip" aria-label={`${run_} day streak`}><span className="dot" aria-hidden="true" />{run_}-day streak</span>}
          <button className="iconbtn" aria-label="Settings" onClick={onSettings}><Icon name="settings" /></button>
        </div>
      </div>

      {noAccounts ? <Empty>Add an account in Settings to start logging.</Empty> : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void read(text, "ai"); }}>
          <label className="lbl" htmlFor="quick">Say or type what you spent</label>
          <div className="composer">
            <input id="quick" className="field grow" placeholder="swiggy 340 upi" value={text} maxLength={300} autoComplete="off"
              onChange={(e) => setText(e.target.value)} />
            <Mic onText={(t) => { setText(t); void read(t, "ai"); }} />
            <button className="btn primary" style={{ height: "var(--h-md)" }} disabled={busy || !text.trim()}>{busy ? "…" : "Log"}</button>
          </div>
          <div className="row links">
            <button type="button" className="btn quiet" onClick={() => by_hand()}>Add by hand</button>
            <button type="button" className="btn quiet" onClick={() => setSms("")}>Paste an SMS</button>
            <button type="button" className="btn quiet" onClick={() => by_hand({ transfer: true })}>Move money</button>
          </div>
        </form>
      )}
      {error && !pending && <p className="error" role="alert">{error}</p>}

      {pending && (
        <div className="hero confirm stack" role="group" aria-label="Check this entry">
          <div className="row" style={{ justifyContent: "space-between" }}><span className="caps">Is this right?</span>
            <span className="caps">{pending.source === "ai" ? "Read by AI" : "Read on your phone"}</span></div>
          <div className="big">{pending.draft.amount ? formatMoney(cardOk?.ok ? cardOk.minor : 0, acc(pending.draft.accountId)?.currency ?? "INR") : "No amount"}</div>
          <div>
            {pending.draft.transfer
              ? `Moved from ${acc(pending.draft.accountId)?.name ?? "?"} to ${acc(pending.draft.toAccountId)?.name ?? "?"}`
              : <>{pending.draft.direction === "spent" ? "Spent" : "Received"} · <b>{pending.draft.name || "?"}</b> · {acc(pending.draft.accountId)?.name ?? "pick an account"}
                {pending.draft.categoryId && <> · {L.categoryById.get(pending.draft.categoryId)?.name}</>}</>}
            <span className="muted"> · {pending.draft.date === today ? "today" : dayLabel(pending.draft.date)}</span>
          </div>
          {pending.assumed && <p className="small" style={{ margin: 0, color: "var(--on-ink-muted)" }}>No account was mentioned, so this uses your last one.</p>}
          {pending.hint && <p className="notice" style={{ margin: 0 }}>{pending.hint}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button className="btn lime grow" onClick={confirm} disabled={busy || !cardOk?.ok}><Icon name="check" size={18} />Confirm</button>
            <button className="btn ghost grow" onClick={() => { setForm({ draft: pending.draft, via: pending.via, original: pending.draft, hint: pending.hint, source: pending.source }); setPending(null); }}>Edit</button>
            <button className="iconbtn dark" aria-label="Discard" onClick={reject}><Icon name="close" /></button>
          </div>
        </div>
      )}

      {review && L.entries.length > 0 && (
        <button className="card item banner" onClick={() => onReview(review)}>
          <span className="grow"><b>Your {monthLabel(review)} review is ready</b><br /><span className="muted small">See where the money went and plan the next month.</span></span><Icon name="next" />
        </button>
      )}

      <section className="card stack" aria-label="Today's status" style={{ gap: "var(--sp-2)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <span className={`pill ${stat === "logged" ? "green" : stat === "no_spend" ? "green" : "amber"}`}>{stat === "logged" ? "Logged" : stat === "no_spend" ? "No spend" : "Open"}</span>
            {spent.size > 0 && <div className="big" style={{ marginTop: "var(--sp-2)" }}>{[...spent].map(([c, m]) => formatMoney(m, c)).join(" · ")}</div>}
            {spent.size > 0 && <div className="muted small">spent today</div>}
          </div>
          {stat !== "logged" && (
            <button className="btn" disabled={busy} onClick={() => run(async () => { await setNoSpend(today, stat !== "no_spend"); })}>
              {stat === "no_spend" ? "Undo no spend" : "I spent nothing"}
            </button>
          )}
        </div>
        {stat === "open" && <p className="muted small" style={{ margin: 0 }}>Nothing yet today. Log what you spent, or tap “I spent nothing”.</p>}
      </section>

      {missed.length > 0 && (
        <section className="card stack" aria-label="Blank days" style={{ gap: "var(--sp-2)" }}>
          <b>Some days are blank</b>
          <p className="muted small" style={{ margin: 0 }}>Add what you remember, or mark a day as no spend.</p>
          {missed.map((d) => (
            <div key={d} className="row">
              <span className="grow">{dayLabel(d)}</span>
              <button className="btn" style={{ height: "var(--h-sm)" }} onClick={() => run(async () => { await setNoSpend(d, true); })}>No spend</button>
              <button className="btn" style={{ height: "var(--h-sm)" }} onClick={() => by_hand({ date: d })}>Add</button>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        {lines.length ? <Lines lines={lines} onOpen={setDetail} /> : <Empty>Nothing logged today.</Empty>}
      </section>

      {sms !== null && (
        <Sheet title="Paste a bank or UPI SMS" onClose={() => setSms(null)}>
          <textarea className="field" style={{ height: 140, padding: "var(--sp-3)" }} aria-label="SMS text" autoFocus value={sms} maxLength={600} onChange={(e) => setSms(e.target.value)} />
          <p className="muted small" style={{ margin: 0 }}>Balances and account numbers are removed before it's read. You'll check it before anything is saved.</p>
          <button className="btn primary" disabled={busy || !sms.trim()} onClick={() => read(sms, "sms")}>{busy ? "Reading…" : "Read it"}</button>
        </Sheet>
      )}
      {form && <EntrySheet initial={form.draft} existing={form.existing} via={form.via} aiOriginal={form.original} source={form.source} hint={form.hint} onClose={() => setForm(null)} />}
      {detail && <Detail entry={detail} onClose={() => setDetail(null)} onEdit={(e) => {
        const a = L.accountById.get(e.account_id);
        setForm({ draft: draftFromEntry(e, a?.currency ?? "INR"), existing: e, via: "manual" });
        setDetail(null);
      }} />}
    </main>
  );
}

/** Voice input through the browser's own speech recognition (English, India). Hidden where unsupported. */
function Mic({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const rec = useRef<{ stop(): void } | null>(null);
  const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
  if (!Ctor) return null;
  function toggle() {
    if (on) { rec.current?.stop(); return; }
    const r = new Ctor!(); rec.current = r;
    r.lang = "en-IN"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => onText(e.results[0][0].transcript);
    r.onend = () => setOn(false); r.onerror = () => setOn(false);
    setOn(true); r.start();
  }
  return <button type="button" className={`btn mic${on ? " on" : ""}`} aria-pressed={on} aria-label={on ? "Stop listening" : "Speak an entry"} onClick={toggle}><Icon name={on ? "stop" : "mic"} /></button>;
}
type SR = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void; onend: () => void; onerror: () => void; start(): void; stop(): void };
