import Icon from "../Icon";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "../lib/actions";
import { ToastHost } from "../components";
import { APP_NAME } from "../config";
import { useLedger, useToday } from "../lib/hooks";
import { dayState, streak } from "../lib/ledger";
import { dayLabel } from "../lib/format";
import { emptyDraft } from "../lib/entryRows";
import EntrySheet, { LAST_ACCOUNT } from "./EntrySheet";
import { openUser, sync, useStore } from "../lib/store";
import History from "./History";
import Metrics from "./Metrics";
import Plan from "./Plan";
import Review from "./Review";
import Settings from "./Settings";
import Stats from "./Stats";
import Today from "./Today";

type Tab = "today" | "history" | "stats";
type Overlay = { k: "settings" } | { k: "metrics" } | { k: "review"; ym: string } | null;
// The old app's layout: a header on every screen, a dark dock with the tabs, and a green Add button.
const TABS: [Tab, string][] = [["today", "Today"], ["history", "History"], ["stats", "Stats"]];  // the tab key is also its icon name

export default function Shell({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>("today");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [plan, setPlan] = useState(false);     // Stats tab: Spending or Plan
  const [adding, setAdding] = useState(false);
  const s = useStore();
  const L = useLedger();
  const today = useToday();
  const opened = useRef(false);
  const run = streak(today, (d: string) => dayState(d, L.loggedDates, L.noSpend), s.firstDay || today);
  const lastAccount = () => { try { return localStorage.getItem(LAST_ACCOUNT); } catch { return null; } };

  useEffect(() => {
    let live = true;
    openUser(userId).then(() => { if (live) void sync(); });
    const refresh = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => { live = false; document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, [userId]);

  // One "app opened" metric per launch, with the streak at that moment.
  useEffect(() => {
    if (opened.current || !s.ready || s.status === "syncing") return;
    opened.current = true;
    const st = (d: string) => dayState(d, L.loggedDates, L.noSpend);
    logEvent("app_open", { streak: streak(today, st, s.firstDay || today) });
  }, [s.ready, s.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s.ready) return <main className="screen"><p className="muted" role="status">{s.status === "offline" ? "You're offline and there's nothing saved on this device yet." : "Loading your ledger…"}</p></main>;

  if (overlay?.k === "settings") return <><Settings onBack={() => setOverlay(null)} onMetrics={() => setOverlay({ k: "metrics" })} /><ToastHost /></>;
  if (overlay?.k === "metrics") return <Metrics onBack={() => setOverlay({ k: "settings" })} />;
  if (overlay?.k === "review") return <><Review ym={overlay.ym} onClose={() => setOverlay(null)} onPlan={() => { setOverlay(null); setTab("stats"); setPlan(true); }} /><ToastHost /></>;

  return (
    <div className="app">
      {s.status === "offline" && <div className="notice" role="status" style={{ borderRadius: 0, textAlign: "center" }}>Offline. Showing what was last synced. Saving needs a connection.</div>}
      <header className="apphead">
        <div><h1>{APP_NAME}</h1><div className="muted small">{dayLabel(today)}</div></div>
        <div className="row">
          {run > 0 && <span className="statuschip" aria-label={`${run} day streak`}><span className="dot" aria-hidden="true" />{run}<span className="wide">-day streak</span></span>}
          <button className="iconbtn" aria-label="Settings" onClick={() => setOverlay({ k: "settings" })}><Icon name="user" /></button>
        </div>
      </header>
      {tab === "today" && <Today onReview={(ym) => setOverlay({ k: "review", ym })} />}
      {tab === "history" && <History />}
      {tab === "stats" && <>
        <div className="screen" style={{ paddingBottom: 0 }}><div className="seg" role="group" aria-label="Stats view">
          <button aria-pressed={!plan} onClick={() => setPlan(false)}>Spending</button>
          <button aria-pressed={plan} onClick={() => setPlan(true)}>Plan</button>
        </div></div>
        {plan ? <Plan onReview={(ym) => setOverlay({ k: "review", ym })} /> : <Stats />}
      </>}
      {adding && <EntrySheet initial={emptyDraft(today, lastAccount() ?? (L.activeAccounts.length === 1 ? L.activeAccounts[0].id : ""))} via="manual" onClose={() => setAdding(false)} />}
      <ToastHost />
      <div className="navwrap"><div className="dock">
        <nav className="navpill" aria-label={APP_NAME}>
          {TABS.map(([k, label]) => <button key={k} className="tab" aria-label={label} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><Icon name={k} size={20} /><span>{label}</span></button>)}
        </nav>
        <button className="dockadd" onClick={() => setAdding(true)} disabled={L.activeAccounts.length === 0}><Icon name="plus" size={20} /><span>Add</span></button>
      </div></div>
    </div>
  );
}
