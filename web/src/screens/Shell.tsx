import Icon from "../Icon";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "../lib/actions";
import { MonthPill, ToastHost } from "../components";
import { APP_NAME } from "../config";
import { useLedger, useScrollTop, useToday } from "../lib/hooks";
import { addMonths, monthOf, openPastDays } from "../lib/ledger";
import { Avatar } from "../lib/avatars";
import { useProfile } from "../lib/profile";
import { supabase } from "../supabase";
import { openUser, sync, useStore } from "../lib/store";
import History from "./History";
import Metrics from "./Metrics";
import OpenDays from "./OpenDays";
import Plan from "./Plan";
import QuickAdd from "./QuickAdd";
import Review from "./Review";
import Profile from "./Profile";
import Stats from "./Stats";

type Tab = "stats" | "history";
type Overlay = { k: "profile" } | { k: "metrics" } | { k: "review"; ym: string } | null;
// The old app's layout: the month pill on top, a dark dock with Stats and History, and the green Add payment button.
const TABS: [Tab, string][] = [["stats", "Stats"], ["history", "History"]];  // the tab key is also its icon name

export default function Shell({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>("stats");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [plan, setPlan] = useState(false);     // Dashboard: Spending or Plan
  const today = useToday();
  const [pickedYm, setYm] = useState(monthOf(today));
  const s = useStore();
  const L = useLedger();
  const { profile, save } = useProfile(userId);
  const opened = useRef(false);
  const [histOpen, setHistOpen] = useState(false);     // History: only open days
  // Only Plan can look a month ahead.
  const max = tab === "stats" && plan ? addMonths(monthOf(today), 1) : monthOf(today);
  const ym = pickedYm > max ? max : pickedYm;
  useScrollTop(tab, plan, overlay?.k);

  useEffect(() => {
    let live = true;
    openUser(userId).then(() => { if (live) void sync(); });
    // "Today" for the database's close/reopen rule is today in this time zone.
    try { void supabase.from("profiles").update({ time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone }).eq("user_id", userId).then(() => undefined, () => undefined); } catch { /* ignore */ }
    const refresh = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => { live = false; document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, [userId]);

  // One "app opened" metric per launch, with the streak at that moment.
  useEffect(() => {
    if (opened.current || !s.ready || s.status === "syncing") return;
    opened.current = true;
    logEvent("app_open", { open_days: openPastDays(today, L.closed, L.start).length, installed: matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true });
  }, [s.ready, s.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s.ready) return <main className="screen"><p className="muted" role="status">{s.status === "offline" ? "You're offline and there's nothing saved on this device yet." : "Loading your ledger…"}</p></main>;

  if (overlay?.k === "profile") return <><Profile profile={profile} save={save} onClose={() => setOverlay(null)} onMetrics={() => setOverlay({ k: "metrics" })} /><ToastHost /></>;
  if (overlay?.k === "metrics") return <Metrics onBack={() => setOverlay({ k: "profile" })} />;
  if (overlay?.k === "review") return <><Review ym={overlay.ym} onClose={() => setOverlay(null)} onPlan={() => { setOverlay(null); setTab("stats"); setPlan(true); setYm(overlay.ym); }} /><ToastHost /></>;

  return (
    <div className="app">
      {s.status === "offline" && <div className="notice" role="status" style={{ borderRadius: 0, textAlign: "center" }}>Offline. Showing what was last synced. Saving needs a connection.</div>}
      <header className="apphead">
        <MonthPill ym={ym} max={max} onChange={setYm} />
        <div className="row">
          <button className="avbtn" aria-label="Your profile" onClick={() => setOverlay({ k: "profile" })}><Avatar avatar={profile?.avatar} name={profile?.display_name || profile?.email} size={44} /></button>
        </div>
      </header>
      {tab === "history" && <History ym={ym} openOnly={histOpen} onOpenOnly={setHistOpen} />}
      {tab === "stats" && <>
        <div className="screen stack" style={{ paddingBottom: 0, gap: "var(--sp-3)" }}>
          <div className="seg" role="group" aria-label="Dashboard view">
            <button aria-pressed={!plan} onClick={() => setPlan(false)}>Spending</button>
            <button aria-pressed={plan} onClick={() => setPlan(true)}>Plan</button>
          </div>
          {!plan && <OpenDays onShow={() => { setHistOpen(true); setTab("history"); }} onReview={(m: string) => setOverlay({ k: "review", ym: m })} />}
        </div>
        {plan ? <Plan ym={ym} onReview={(m) => setOverlay({ k: "review", ym: m })} /> : <Stats ym={ym} />}
      </>}
      <ToastHost />
      <div className="navwrap"><div className="dock">
        <nav className="navpill" aria-label={APP_NAME} style={{ "--i": TABS.findIndex(([k]) => k === tab) } as React.CSSProperties}>
          <span className="navblob" aria-hidden="true" />
          {TABS.map(([k, label]) => <button key={k} className="tab" aria-label={label} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><Icon name={k} size={20} /><span>{label}</span></button>)}
        </nav>
        <QuickAdd />
      </div></div>
    </div>
  );
}
