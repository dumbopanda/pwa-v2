import { useMemo, useState } from "react";
import { firstSaveMs, logEvent, saveDraft } from "../lib/actions";
import { AccountTiles, currencySymbol, Sheet, toast, useAction } from "../components";
import Icon from "../Icon";
import { addDays } from "../lib/ledger";
import { checkDraft, type Draft } from "../lib/entryRows";
import { formatMoney } from "../lib/money";
import { useLedger, useToday } from "../lib/hooks";
import type { Entry } from "../lib/types";

export const LAST_ACCOUNT = "lastAccount";

/** Add, edit or confirm-and-fix an entry. `via` says where it came from, for the usage metrics. */
export default function EntrySheet({ initial, existing, via, aiOriginal, source, hint, onClose }: {
  initial: Draft; existing?: Entry; via: "manual" | "ai" | "sms"; aiOriginal?: Draft; source?: "rules" | "ai"; hint?: string; onClose: () => void;
}) {
  const { accounts, activeAccounts, activeCategories, accountById } = useLedger();
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
    if (via !== "manual" && aiOriginal) logEvent("ai_result", { outcome: JSON.stringify(aiOriginal) === JSON.stringify(d) ? "accepted" : "edited", source: source ?? "ai" });
    toast(existing ? "Changes saved" : "Saved");
    onClose();
  }

  const label = check.ok && from ? `${existing ? "Save changes" : "Save"} · ${formatMoney(check.minor, from.currency)}${d.transfer ? " moved" : d.direction === "spent" ? " out" : " in"}` : existing ? "Save changes" : "Save";

  const cur = from?.currency ?? activeAccounts[0]?.currency ?? "INR";
  const yesterday = addDays(today, -1);

  return (
    <Sheet title={existing ? "Edit entry" : d.transfer ? "Move money" : "New entry"} onClose={onClose}>
      {hint && <p className="notice" style={{ margin: 0 }}>{hint}</p>}

      <div className="hero">
        <label className="sr-only" htmlFor="amount">Amount in {cur}</label>
        <div className="heroamt">
          <span className="sym" aria-hidden="true">{currencySymbol(cur)}</span>
          <input id="amount" inputMode="decimal" autoComplete="off" autoFocus={!initial.amount} placeholder="0"
            style={{ width: `${Math.min(12, Math.max(1, d.amount.length)) + 0.4}ch` }}
            value={d.amount} onChange={(e) => set({ amount: e.target.value })} />
        </div>
        <p className="readback" aria-live="polite">{check.ok ? formatMoney(check.minor, cur) : "\u00a0"}</p>
        <div className="seg dark" role="group" aria-label="Type">
          <button type="button" aria-pressed={!d.transfer && d.direction === "spent"} onClick={() => set({ transfer: false, direction: "spent" })}><Icon name="out" size={18} />Spent</button>
          <button type="button" aria-pressed={!d.transfer && d.direction === "received"} onClick={() => set({ transfer: false, direction: "received" })}><Icon name="in" size={18} />Received</button>
          {!existing && <button type="button" aria-pressed={d.transfer} onClick={() => set({ transfer: true, categoryId: "" })}><Icon name="move" size={18} />Transfer</button>}
        </div>
      </div>

      <div className="stack" style={{ gap: "var(--sp-2)" }}>
        <span className="caps">{d.transfer ? "From" : "Account"}</span>
        <AccountTiles order={accounts} label={d.transfer ? "From account" : "Account"} accounts={activeAccounts} value={d.accountId}
          onPick={(id) => set({ accountId: id, toAccountId: d.toAccountId === id ? "" : d.toAccountId })} />
      </div>
      {d.transfer && (
        <div className="stack" style={{ gap: "var(--sp-2)" }}>
          <span className="caps">To</span>
          <AccountTiles order={accounts} label="To account" accounts={activeAccounts.filter((a) => a.id !== d.accountId && sameCurrency(a.id))} value={d.toAccountId} onPick={(id) => set({ toAccountId: id })} />
        </div>
      )}

      <div className="group">
        {!d.transfer && (
          <>
            <div className="grow-row"><Icon name="tag" />
              <div className="grow"><label className="rowlbl" htmlFor="name">Name or place</label>
                <input id="name" maxLength={120} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Swiggy, chai, rent…" /></div></div>
            <div className="grow-row"><Icon name="grid" />
              <div className="grow"><label className="rowlbl" htmlFor="cat">Category</label>
                <select id="cat" value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                  <option value="">No category</option>
                  {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div></div>
          </>
        )}
        <div className="grow-row"><Icon name="calendar" />
          <div className="grow"><label className="rowlbl" htmlFor="date">Date</label>
            <input id="date" type="date" max={today} value={d.date} onChange={(e) => set({ date: e.target.value })} /></div>
          <button type="button" className="qchip" aria-pressed={d.date === today} onClick={() => set({ date: today })}>Today</button>
          <button type="button" className="qchip" aria-pressed={d.date === yesterday} onClick={() => set({ date: yesterday })}>Yesterday</button>
        </div>
        <div className="grow-row"><Icon name="note" />
          <div className="grow"><label className="rowlbl" htmlFor="note">Note (optional)</label>
            <input id="note" maxLength={300} value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder="Anything to remember" /></div></div>
      </div>

      {error ? <p className="error" role="alert" style={{ textAlign: "center" }}>{error}</p>
        : !check.ok && <p className="caption" aria-live="polite">{check.error}</p>}
      <div className="sheetfoot">
        <button className="btn primary" style={{ width: "100%" }} onClick={save} disabled={busy || !check.ok}>{busy ? "Saving…" : label}</button>
      </div>
    </Sheet>
  );
}
