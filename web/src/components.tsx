import Icon from "./Icon";
import { toneOf } from "./lib/ledger";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet stack" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="grabber" aria-hidden="true" />
        <div className="row"><h2 className="grow">{title}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        {children}
      </div>
    </div>
  );
}

// One toast at a time, with an optional action (Undo).
type T = { msg: string; action?: { label: string; run: () => void } } | null;
let toastNow: T = null; let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
export function toast(msg: string, action?: { label: string; run: () => void }) {
  toastNow = { msg, action }; subs.forEach((f) => f());
  clearTimeout(timer); timer = setTimeout(() => { toastNow = null; subs.forEach((f) => f()); }, 5000);
}
export function ToastHost() {
  const t = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => toastNow);
  if (!t) return null;
  return (
    <div className="toast" role="status">
      <span className="grow">{t.msg}</span>
      {t.action && <button className="btn quiet" onClick={() => { t.action!.run(); toastNow = null; subs.forEach((f) => f()); }}>{t.action.label}</button>}
    </div>
  );
}

export function MonthNav({ ym, label, onChange, max }: { ym: string; label: string; onChange: (d: -1 | 1) => void; max: string }) {
  return (
    <div className="monthnav">
      <button className="btn icon" aria-label="Previous month" onClick={() => onChange(-1)}><Icon name="back" /></button>
      <h2 aria-live="polite">{label}</h2>
      <button className="btn icon" aria-label="Next month" onClick={() => onChange(1)} disabled={ym >= max}><Icon name="next" /></button>
    </div>
  );
}

export function Bar({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="bar" role="presentation"><span className={over ? "over" : ""} style={{ width: `${pct}%` }} /></div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted small" style={{ textAlign: "center", padding: "var(--sp-6) 0", margin: 0 }}>{children}</p>;
}

/** Runs an async action with a busy flag and an error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(f: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null);
    try { return await f(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }
  return { busy, error, run, setError };
}

/** "₹", "$", "JP¥" for a currency, from the platform's own data. */
export const currencySymbol = (c: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: c }).formatToParts(0).find((p) => p.type === "currency")?.value ?? c;

/** Account tiles: a coloured initial per account, a check on the picked one. Colours cycle by position. */
export function AccountTiles({ accounts, value, onPick, label, order }: { accounts: { id: string; name: string }[]; value: string; onPick: (id: string) => void; label: string; order: { id: string }[] }) {
  return (
    <div className="tiles" role="group" aria-label={label}>
      {accounts.map((a) => (
        <button key={a.id} type="button" className="tile" aria-pressed={value === a.id} onClick={() => onPick(a.id)}>
          <span className={`mono acc${toneOf(order, a.id)}`} aria-hidden="true">{a.name.trim().charAt(0).toUpperCase()}</span>
          <span className="tname">{a.name}</span>
          {value === a.id && <span className="tick" aria-hidden="true"><Icon name="check" size={14} /></span>}
        </button>
      ))}
    </div>
  );
}
