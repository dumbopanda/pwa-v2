import Icon from "../Icon";
import { toneOf } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import type { Account, Category, Entry } from "../lib/types";

/** What one row shows. A transfer's two rows fold into one line. */
export type Line = { entry: Entry; title: string; sub: string; note: string | null; amount: string; kind: "out" | "in" | "move"; initial: string; tone: number };

export function buildLines(entries: Entry[], accountById: Map<string, Account>, categoryById: Map<string, Category>, order: Account[] = []): Line[] {
  const legs = new Map<string, Entry[]>();
  for (const e of entries) if (e.transfer_group) legs.set(e.transfer_group, [...(legs.get(e.transfer_group) ?? []), e]);
  const out: Line[] = [];
  for (const e of entries) {
    const a = accountById.get(e.account_id); const cur = a?.currency ?? "INR";
    const base = { entry: e, amount: formatMoney(e.amount_minor, cur), note: e.more_info, initial: (a?.name ?? "?").trim().charAt(0).toUpperCase(), tone: toneOf(order, e.account_id) };
    if (e.transfer_group) {
      if (e.direction !== "debit") continue;                       // show the sending leg only
      const to = legs.get(e.transfer_group)?.find((x) => x.direction === "credit");
      out.push({ ...base, title: "Self transfer", sub: `${a?.name ?? "?"} → ${accountById.get(to?.account_id ?? "")?.name ?? "?"}`, kind: "move" });
    } else {
      const cat = e.category_id ? categoryById.get(e.category_id)?.name : null;
      out.push({ ...base, title: e.expense_name, sub: [a?.name, cat].filter(Boolean).join(" · "), kind: e.direction === "debit" ? "out" : "in" });
    }
  }
  return out;
}

/** Rows as in the old app: account tile, name and amount on top, account and category below, your note under that. */
export function Lines({ lines, onOpen }: { lines: Line[]; onOpen: (e: Entry) => void }) {
  return (
    <div className="txns">
      {lines.map((l) => (
        <button key={l.entry.id} type="button" className={`txn${l.kind === "move" ? " self" : ""}`} onClick={() => onOpen(l.entry)}>
          <span className={`ttile ${l.kind === "move" ? "move" : `acc${l.tone}`}`} aria-hidden="true">{l.kind === "move" ? <Icon name="move" size={16} /> : l.initial}</span>
          <span className="tbody">
            <span className="tline1">
              <span className="tname">{l.title}</span>
              <span className={`tamt ${l.kind === "move" ? "flat" : l.kind}`}>{l.kind === "out" ? "−" : l.kind === "in" ? "+" : ""}{l.amount}</span>
            </span>
            <span className="tmeta">{l.sub}</span>
            {l.note && <span className="tnote">{l.note}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
