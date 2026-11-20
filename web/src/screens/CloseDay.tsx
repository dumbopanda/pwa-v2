import Icon from "../Icon";
import { closeDay } from "../lib/actions";
import { Sheet, toast, useAction } from "../components";
import { dayLabel } from "../lib/format";
import { useLedger, useToday } from "../lib/hooks";
import { isLogged } from "../lib/ledger";
import { formatMoney } from "../lib/money";

/**
 * "Every payment for this day is added." An empty day gets a warning first:
 * closing it says you spent nothing.
 */
export default function CloseDay({ date, onClose }: { date: string; onClose: () => void }) {
  const L = useLedger(); const today = useToday();
  const { busy, error, run } = useAction();
  const es = L.entries.filter((e) => e.entry_date === date && isLogged(e));
  const lines = es.filter((e) => !e.transfer_group || e.direction === "debit").length;   // a transfer is one line
  const sum = (dir: "debit" | "credit") => {
    const m = new Map<string, number>();
    for (const e of es) if (!e.transfer_group && e.direction === dir) { const c = L.accountById.get(e.account_id)?.currency ?? "INR"; m.set(c, (m.get(c) ?? 0) + e.amount_minor); }
    return m.size ? [...m].map(([c, v]) => formatMoney(v, c)).join(" · ") : "₹0";
  };
  const empty = lines === 0;
  const label = dayLabel(date);

  async function confirm() {
    const ok = await run(async () => { await closeDay(date); return true; });
    if (!ok) return;
    toast(empty ? "Closed as no spend" : "Day closed");
    onClose();
  }

  return (
    <Sheet title={`Close ${label}?`} onClose={onClose}>
      {empty ? (
        <>
          <div className="warnbox"><Icon name="warn" /><span>No payments are recorded for this day.</span></div>
          <p className="sheetline" style={{ margin: 0 }}>Closing it says <b>you spent nothing</b> on {label}. If you did spend, go back and add it first.</p>
        </>
      ) : (
        <>
          <div className="card facts" style={{ padding: 0 }}>
            <div className="fact"><span className="k">Entries</span><span className="v">{lines}</span></div>
            <div className="fact"><span className="k">Money out</span><span className="v">{sum("debit")}</span></div>
            <div className="fact"><span className="k">Money in</span><span className="v">{sum("credit")}</span></div>
          </div>
          <p className="sheetline" style={{ margin: 0 }}>By closing, you're saying <b>every payment for this day is added</b>. Anything you add later is marked <i>added after closing</i>.</p>
        </>
      )}
      <p className="muted small" style={{ margin: 0 }}>{date === today ? "You can reopen it until midnight. After that it stays closed." : "This day is over, so once closed it stays closed."}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheetactions">
        <button className="btn" onClick={onClose}>Go back</button>
        <button className="btn primary" disabled={busy} onClick={confirm}>{busy ? "Closing…" : empty ? "Yes, I spent nothing" : "Close day"}</button>
      </div>
    </Sheet>
  );
}
