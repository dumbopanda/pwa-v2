import { dayLabel } from "../lib/format";
import { formatMoney } from "../lib/money";
import type { Account, Category, Entry } from "../lib/types";

/** What one line in a list shows. A transfer's two rows fold into one line. */
export type Line = { entry: Entry; title: string; sub: string; amount: string; kind: "out" | "in" | "move" };

export function buildLines(entries: Entry[], accountById: Map<string, Account>, categoryById: Map<string, Category>): Line[] {
  const legs = new Map<string, Entry[]>();
  for (const e of entries) if (e.transfer_group) legs.set(e.transfer_group, [...(legs.get(e.transfer_group) ?? []), e]);
  const out: Line[] = [];
  for (const e of entries) {
    const a = accountById.get(e.account_id); const cur = a?.currency ?? "INR";
    if (e.transfer_group) {
      if (e.direction !== "debit") continue;                       // show the sending leg only
      const to = legs.get(e.transfer_group)?.find((x) => x.direction === "credit");
      out.push({ entry: e, title: "Self transfer", sub: `${a?.name ?? "?"} → ${accountById.get(to?.account_id ?? "")?.name ?? "?"}`, amount: formatMoney(e.amount_minor, cur), kind: "move" });
    } else {
      const cat = e.category_id ? categoryById.get(e.category_id)?.name : null;
      out.push({ entry: e, title: e.expense_name, sub: [a?.name, cat].filter(Boolean).join(" · "), amount: formatMoney(e.amount_minor, cur), kind: e.direction === "debit" ? "out" : "in" });
    }
  }
  return out;
}

export function Lines({ lines, onOpen }: { lines: Line[]; onOpen: (e: Entry) => void }) {
  return (
    <div className="list">
      {lines.map((l) => (
        <button key={l.entry.id} className="item" onClick={() => onOpen(l.entry)}>
          <span className="grow"><b>{l.title}</b><br /><span className="muted small">{l.sub}</span></span>
          <span className={`amt ${l.kind === "in" ? "in" : "out"}`}>{l.kind === "out" ? "−" : l.kind === "in" ? "+" : ""}{l.amount}</span>
        </button>
      ))}
    </div>
  );
}

export const dayHeader = dayLabel;
