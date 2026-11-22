import Icon from "./Icon";
import { addMonths, toneOf } from "./lib/ledger";
import { monthLabel } from "./lib/reviewFacts";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

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

/**
 * The month, in a pill. Drag down for the month before (it drops in from the
 * top), drag up for the month after. Arrow keys and the mouse wheel work too.
 */
export function MonthPill({ ym, max, onChange }: { ym: string; max: string; onChange: (ym: string) => void }) {
  const H = 40;
  const [dy, setDy] = useState(0);
  const [anim, setAnim] = useState(false);
  const start = useRef<number | null>(null);
  const wheelAt = useRef(0);
  const prev = addMonths(ym, -1), next = addMonths(ym, 1), canNext = next <= max;
  const go = (d: -1 | 1) => {
    setAnim(true);
    if (d === 1 && !canNext) return setDy(0);
    setDy(d === -1 ? H : -H);
    setTimeout(() => { setAnim(false); setDy(0); onChange(d === -1 ? prev : next); }, 160);
  };
  return (
    <div className="monthpill" role="spinbutton" tabIndex={0} aria-label="Month, drag up or down to change"
      aria-valuenow={Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5))} aria-valuetext={monthLabel(ym)}
      onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); go(-1); } if (e.key === "ArrowUp") { e.preventDefault(); go(1); } }}
      onWheel={(e) => { if (Date.now() - wheelAt.current < 350 || Math.abs(e.deltaY) < 4) return; wheelAt.current = Date.now(); go(e.deltaY > 0 ? 1 : -1); }}
      onPointerDown={(e) => { start.current = e.clientY; setAnim(false); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (start.current === null) return; let v = e.clientY - start.current; if (v < 0 && !canNext) v /= 4; setDy(Math.max(-H, Math.min(H, v))); }}
      onPointerUp={() => { if (start.current === null) return; start.current = null; if (dy > H / 3) go(-1); else if (dy < -H / 3) go(1); else { setAnim(true); setDy(0); } }}
      onPointerCancel={() => { start.current = null; setAnim(true); setDy(0); }}>
      <div className="mp-reel" style={{ transform: `translateY(${dy - H}px)`, transition: anim ? "transform .16s ease-out" : "none" }} aria-hidden="true">
        <span>{monthLabel(prev)}</span><span>{monthLabel(ym)}</span><span className={canNext ? "" : "off"}>{monthLabel(next)}</span>
      </div>
      <Icon name="updown" size={16} />
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

/**
 * "Balance as of": defaults to today. An earlier date asks for a confirmation,
 * because every payment from that date on must then be added (those days stay
 * open until closed). `needsConfirm` is true until the person picks Keep.
 */
export function useBalanceDate(today: string) {
  const [value, setValue] = useState(today);
  const [kept, setKept] = useState(false);
  return { value, setValue: (v: string) => { setValue(v || today); setKept(false); }, kept, setKept, needsConfirm: value < today && !kept };
}
export function BalanceDate({ today, bd }: { today: string; bd: ReturnType<typeof useBalanceDate> }) {
  const back = Math.round((Date.parse(today) - Date.parse(bd.value)) / 86400000);
  const label = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${bd.value}T00:00:00Z`));
  return (
    <div className="stack" style={{ gap: "var(--sp-2)" }}>
      <label className="lbl" htmlFor="asof">Balance as of</label>
      <div className="row">
        <input id="asof" type="date" className="field grow" max={today} value={bd.value} onChange={(e) => bd.setValue(e.target.value)} />
        <button type="button" className="qchip" aria-pressed={bd.value === today} onClick={() => bd.setValue(today)}>Today</button>
      </div>
      {bd.value < today && !bd.kept && (
        <div className="warnbox col" role="alert">
          <b className="row"><Icon name="warn" />Starting {back} {back === 1 ? "day" : "days"} back</b>
          <span>Add every payment from <b>{label}</b> to today, or this balance will be wrong.</span>
          <div className="sheetactions"><button type="button" className="btn" onClick={() => bd.setValue(today)}>Use today</button>
            <button type="button" className="btn primary" onClick={() => bd.setKept(true)}>Keep {label}</button></div>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {bd.value < today && bd.kept ? `Days since ${label} stay open until you close them.` : "Payments can't be dated before this."}
      </p>
    </div>
  );
}
