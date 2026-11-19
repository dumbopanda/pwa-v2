import Icon from "../Icon";
import { useEffect, useRef, useState } from "react";
import { failMessage, historyMap, proposalToDraft, readEntry } from "../lib/ai";
import { firstSaveMs, logEvent, saveDraft } from "../lib/actions";
import { Sheet, toast, useAction } from "../components";
import { checkDraft, emptyDraft, type Draft } from "../lib/entryRows";
import { dayLabel } from "../lib/format";
import { useLedger, useToday } from "../lib/hooks";
import { formatMoney } from "../lib/money";
import EntrySheet, { LAST_ACCOUNT } from "./EntrySheet";

type Pending = { draft: Draft; hint?: string; assumed: boolean; source: "rules" | "ai" };
type Form = { draft: Draft; via: "manual" | "ai"; original?: Draft; hint?: string; source?: "rules" | "ai" };
type SR = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void; onend: () => void; onerror: () => void; start(): void; stop(): void };
const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
const SpeechCtor = W.SpeechRecognition ?? W.webkitSpeechRecognition;

/**
 * The green button in the dock. Tap: it turns into the mic, with "Enter
 * manually" above it. The mic listens, the words are read into an entry,
 * and a sheet asks "Add this entry?" before anything is saved.
 */
export default function QuickAdd() {
  const L = useLedger();
  const today = useToday();
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState<string | null>(null);     // the say-or-type sheet, when open
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const { busy, error, run, setError } = useAction();
  const rec = useRef<SR | null>(null);
  const lastAccount = () => { try { return localStorage.getItem(LAST_ACCOUNT); } catch { return null; } };
  const acc = (id: string) => L.accountById.get(id);
  const noAccounts = L.activeAccounts.length === 0;

  useEffect(() => () => rec.current?.stop(), []);

  function manual() {
    setMenu(false);
    setForm({ draft: emptyDraft(today, lastAccount() ?? (L.activeAccounts.length === 1 ? L.activeAccounts[0].id : "")), via: "manual" });
  }

  function listen() {
    setMenu(false); setText(""); setError(null);
    if (!SpeechCtor) return;
    const r = new SpeechCtor(); rec.current = r;
    r.lang = "en-IN"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => { const t = e.results[0][0].transcript; setText(t); void read(t); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    setListening(true); r.start();
  }

  async function read(raw: string) {
    const t = raw.trim();
    if (!t) return;
    const r = await run(() => readEntry(t, L.activeAccounts, L.activeCategories, today, historyMap(L.entries, L.categories)));
    if (!r) return;
    setText(null);
    if (!r.ok) {
      toast(failMessage(r.fail));
      return setForm({ draft: { ...emptyDraft(today, lastAccount() ?? ""), name: t.slice(0, 120) }, via: "manual" });
    }
    const x = proposalToDraft(r.proposal, L.activeAccounts, L.activeCategories, lastAccount(), today);
    setPending({ draft: x.draft, hint: r.note ?? x.hint, assumed: x.assumedAccount, source: r.source });
  }

  async function confirm() {
    if (!pending) return;
    const c = checkDraft(pending.draft, L.activeAccounts, today);
    if (!c.ok) return setError(c.error);
    // One tap saves exactly what the sheet shows; "Edit entry" handles changes.
    const saved = await run(() => saveDraft(pending.draft, c.minor));
    if (!saved) return;
    try { localStorage.setItem(LAST_ACCOUNT, pending.draft.accountId); } catch { /* ignore */ }
    const ms = firstSaveMs();
    logEvent("entry_saved", { via: "ai", ...(ms !== undefined ? { ms } : {}) });
    logEvent("ai_result", { outcome: "accepted", source: pending.source });
    toast("Saved"); setPending(null);
  }

  function reject() { logEvent("ai_result", { outcome: "rejected", source: pending?.source ?? "ai" }); setPending(null); setError(null); }

  const p = pending?.draft;
  const ok = p ? checkDraft(p, L.activeAccounts, today) : null;
  const cur = p ? acc(p.accountId)?.currency ?? "INR" : "INR";
  const amt = ok?.ok ? formatMoney(ok.minor, cur) : "No amount";
  const when = p ? (p.date === today ? "today" : `on ${dayLabel(p.date)}`) : "";
  const line = !p ? "" : p.transfer
    ? `${amt} moves from your ${acc(p.accountId)?.name ?? "?"} account to your ${acc(p.toAccountId)?.name ?? "?"} account ${when}. Your own money changing hands, so it counts as neither spending nor income.`
    : p.direction === "spent"
      ? `${amt} leaves your ${acc(p.accountId)?.name ?? "?"} account ${when} for ${p.name || "?"}.`
      : `${amt} comes into your ${acc(p.accountId)?.name ?? "?"} account ${when} from ${p.name || "?"}.`;
  const props: [string, string | undefined][] = !p ? [] : [
    ["Amount", ok?.ok ? `${amt} ${p.transfer ? "moved" : p.direction === "spent" ? "out" : "in"}` : "Missing"],
    [p.transfer ? "From account" : "Account", acc(p.accountId)?.name ?? "Pick one"],
    ...(p.transfer ? [["To account", acc(p.toAccountId)?.name ?? "Pick one"] as [string, string]] : []),
    ["Category", p.categoryId ? L.categoryById.get(p.categoryId)?.name : undefined],
    ["Name", p.transfer ? undefined : p.name || undefined],
    ["Note", p.note || undefined],
    ["Date", dayLabel(p.date)],
    ["Read", pending?.source === "ai" ? "by AI" : "on your phone"],
  ];

  return (
    <>
      {menu && <div className="addscrim" onClick={() => setMenu(false)} />}
      {menu && (
        <div className="addmenu">
          <button className="addopt" onClick={manual}><Icon name="note" size={20} />Enter manually</button>
        </div>
      )}
      {menu
        ? <button className="dockadd mic" aria-label="Speak an entry" onClick={listen}><Icon name="mic" size={22} /><span>Speak</span></button>
        : <button className="dockadd" aria-expanded={false} onClick={() => setMenu(true)} disabled={noAccounts}><Icon name="plus" size={20} /><span>Add payment</span></button>}

      {text !== null && (
        <Sheet title="Say it or type it" onClose={() => { rec.current?.stop(); setText(null); }}>
          {SpeechCtor && (
            <button type="button" className={`bigmic${listening ? " on" : ""}`} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak again"}
              onClick={() => (listening ? rec.current?.stop() : listen())}><Icon name={listening ? "stop" : "mic"} size={30} /></button>
          )}
          <p className="caption" aria-live="polite">{busy ? "Reading…" : listening ? "Listening… say it like “swiggy 340 upi”" : SpeechCtor ? "Tap the mic, or type below" : "Voice isn't available in this browser. Type it below."}</p>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void read(text); }}>
            <label className="sr-only" htmlFor="quick">Say or type what you spent</label>
            <textarea id="quick" className="field" style={{ height: 88, padding: "var(--sp-3)" }} placeholder="swiggy 340 upi, or paste a bank SMS" maxLength={600}
              value={text} onChange={(e) => setText(e.target.value)} />
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary" disabled={busy || !text.trim()}>{busy ? "Reading…" : "Read it"}</button>
          </form>
        </Sheet>
      )}

      {pending && p && (
        <Sheet title="Add this entry?" onClose={reject}>
          <p className="sheetline">{line}</p>
          {pending.assumed && <p className="sheetnote">No account was mentioned, so this uses your last one.</p>}
          {pending.hint && <p className="sheetnote">{pending.hint}</p>}
          <div className="card facts" style={{ padding: 0 }}>
            {props.filter(([, v]) => v).map(([k, v]) => <div key={k} className="fact"><span className="k">{k}</span><span className="v">{v}</span></div>)}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sheetactions">
            <button className="btn" onClick={() => { setForm({ draft: p, via: "ai", original: p, hint: pending.hint, source: pending.source }); setPending(null); }}>Edit entry</button>
            <button className="btn primary" onClick={confirm} disabled={busy || !ok?.ok}>{busy ? "Saving…" : "Add entry"}</button>
          </div>
        </Sheet>
      )}

      {form && <EntrySheet initial={form.draft} via={form.via} aiOriginal={form.original} source={form.source} hint={form.hint} onClose={() => setForm(null)} />}
    </>
  );
}
