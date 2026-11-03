import { useState } from "react";
import { deleteEntry, undoDelete } from "../lib/actions";
import { Sheet, toast, useAction } from "../components";
import { dayLabel } from "../lib/format";
import { useLedger } from "../lib/hooks";
import { formatMoney } from "../lib/money";
import type { Entry } from "../lib/types";

/** Tap on any line. Edit or delete; a delete can be undone for 5 seconds. */
export default function Detail({ entry, onEdit, onClose }: { entry: Entry; onEdit: (e: Entry) => void; onClose: () => void }) {
  const { entries, accountById, categoryById } = useLedger();
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const a = accountById.get(entry.account_id);
  const other = entry.transfer_group ? entries.find((e) => e.transfer_group === entry.transfer_group && e.id !== entry.id) : undefined;
  const cur = a?.currency ?? "INR";

  async function del() {
    const ok = await run(async () => { await deleteEntry(entry); return true; });
    if (!ok) return;
    onClose();
    toast("Deleted", { label: "Undo", run: () => { undoDelete(entry).then(() => toast("Restored"), (e) => toast(e.message)); } });
  }

  return (
    <Sheet title={entry.transfer_group ? "Self transfer" : entry.expense_name} onClose={onClose}>
      <div className="card stack" style={{ gap: "var(--sp-2)" }}>
        <div className="big">{entry.direction === "debit" && !entry.transfer_group ? "−" : entry.direction === "credit" && !entry.transfer_group ? "+" : ""}{formatMoney(entry.amount_minor, cur)}</div>
        <div className="muted">{dayLabel(entry.entry_date)}</div>
        {entry.transfer_group
          ? <div>{a?.name} → {accountById.get(other?.account_id ?? "")?.name ?? "?"}</div>
          : <><div>{a?.name}</div>{entry.category_id && <div className="muted">{categoryById.get(entry.category_id)?.name}</div>}</>}
        {entry.more_info && <div className="muted">{entry.more_info}</div>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!confirm ? (
        <div className="row">
          <button className="btn grow" onClick={() => setConfirm(true)}>Delete</button>
          {!entry.transfer_group && <button className="btn primary grow" style={{ height: "var(--h-md)" }} onClick={() => onEdit(entry)}>Edit</button>}
        </div>
      ) : (
        <div className="stack">
          <p style={{ margin: 0 }}>{entry.transfer_group ? "This removes both sides of the transfer." : "Delete this entry?"} You can undo it for a few seconds.</p>
          <div className="row">
            <button className="btn grow" onClick={() => setConfirm(false)} disabled={busy}>Keep it</button>
            <button className="btn dark grow" style={{ height: "var(--h-md)" }} onClick={del} disabled={busy}>Delete</button>
          </div>
        </div>
      )}
      {entry.transfer_group && <p className="muted small" style={{ margin: 0 }}>To change a transfer, delete it and add it again.</p>}
    </Sheet>
  );
}
