import { useMemo, useState } from "react";
import { firstSaveMs, logEvent, saveDraft } from "../lib/actions";
import { Sheet, toast, useAction } from "../components";
import { checkDraft, type Draft } from "../lib/entryRows";
import { formatMoney } from "../lib/money";
import { useLedger, useToday } from "../lib/hooks";
import type { Entry } from "../lib/types";

export const LAST_ACCOUNT = "lastAccount";

/** Add, edit or confirm-and-fix an entry. `via` says where it came from, for the usage metrics. */
export default function EntrySheet({ initial, existing, via, aiOriginal, hint, onClose }: {
  initial: Draft; existing?: Entry; via: "manual" | "ai" | "sms"; aiOriginal?: Draft; hint?: string; onClose: () => void;
}) {
  const { activeAccounts, activeCategories, accountById } = useLedger();
  const today = useToday();
  const [d, setD] = useState(initial);
  const { busy, error, run, setError } = useAction();
  const set = (p: Partial<Draft>) => { setD((x) => ({ ...x, ...p })); setError(null); };

  const from = accountById.get(d.accountId);
  const check = useMemo(() => checkDraft(d, activeAccounts, today), [d, activeAccounts, today]);
  const sameCurrency = (id: string) => !d.transfer || !from || accountById.get(id)?.currency === from.currency;

  async function save() {
    if (!check.ok) return setError(check.error);
    const saved = await run(() => saveDraft(d, check.minor, existing));
    if (!saved) return;
    try { localStorage.setItem(LAST_ACCOUNT, d.accountId); } catch { /* ignore */ }
    const ms = firstSaveMs();
    logEvent("entry_saved", { via: d.transfer ? "manual" : via, ...(ms !== undefined ? { ms } : {}) });
    if (via === "ai" && aiOriginal) logEvent("ai_result", { outcome: JSON.stringify(aiOriginal) === JSON.stringify(d) ? "accepted" : "edited" });
    toast(existing ? "Changes saved" : "Saved");
    onClose();
  }

  const label = check.ok && from ? `${existing ? "Save changes" : "Save"} · ${formatMoney(check.minor, from.currency)}${d.transfer ? " moved" : d.direction === "spent" ? " out" : " in"}` : existing ? "Save changes" : "Save";

  return (
    <Sheet title={existing ? "Edit entry" : d.transfer ? "Move money" : "Add entry"} onClose={onClose}>
      {hint && <p className="notice" style={{ margin: 0 }}>{hint}</p>}
      <div className="seg" role="group" aria-label="Type">
        <button aria-pressed={!d.transfer && d.direction === "spent"} onClick={() => set({ transfer: false, direction: "spent" })}>Spent</button>
        <button aria-pressed={!d.transfer && d.direction === "received"} onClick={() => set({ transfer: false, direction: "received" })}>Received</button>
        {!existing && <button aria-pressed={d.transfer} onClick={() => set({ transfer: true, categoryId: "" })}>Transfer</button>}
      </div>

      <div>
        <label className="lbl" htmlFor="amount">Amount{from ? ` (${from.currency})` : ""}</label>
        <input id="amount" className="field" style={{ fontSize: "var(--fs-xl)", fontWeight: 800 }} inputMode="decimal" autoComplete="off" autoFocus={!initial.amount}
          value={d.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" />
      </div>

      <div>
        <span className="lbl">{d.transfer ? "From" : "Account"}</span>
        <div className="chips">
          {activeAccounts.map((a) => <button key={a.id} className="chip" aria-pressed={d.accountId === a.id} onClick={() => set({ accountId: a.id, toAccountId: d.toAccountId === a.id ? "" : d.toAccountId })}>{a.name}</button>)}
        </div>
      </div>
      {d.transfer && (
        <div>
          <span className="lbl">To</span>
          <div className="chips">
            {activeAccounts.filter((a) => a.id !== d.accountId && sameCurrency(a.id)).map((a) => <button key={a.id} className="chip" aria-pressed={d.toAccountId === a.id} onClick={() => set({ toAccountId: a.id })}>{a.name}</button>)}
          </div>
        </div>
      )}

      {!d.transfer && (
        <>
          <div>
            <label className="lbl" htmlFor="name">Name or place</label>
            <input id="name" className="field" maxLength={120} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Swiggy, chai, rent…" />
          </div>
          <div>
            <label className="lbl" htmlFor="cat">Category</label>
            <select id="cat" className="field" value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">No category</option>
              {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="row">
        <div className="grow">
          <label className="lbl" htmlFor="date">Date</label>
          <input id="date" className="field" type="date" max={today} value={d.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div className="grow">
          <label className="lbl" htmlFor="note">Note (optional)</label>
          <input id="note" className="field" maxLength={300} value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : label}</button>
    </Sheet>
  );
}
