import Icon from "./Icon";
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
        <div className="row"><h2 className="grow">{title}</h2><button className="btn icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
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
    <div className="row" style={{ justifyContent: "space-between" }}>
      <button className="btn icon" aria-label="Previous month" onClick={() => onChange(-1)}><Icon name="back" /></button>
      <strong>{label}</strong>
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
