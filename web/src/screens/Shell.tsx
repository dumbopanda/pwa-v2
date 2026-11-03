import Icon from "../Icon";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "../lib/actions";
import { ToastHost } from "../components";
import { APP_NAME } from "../config";
import { useLedger, useToday } from "../lib/hooks";
import { dayState, streak } from "../lib/ledger";
import { openUser, sync, useStore } from "../lib/store";
import History from "./History";
import Metrics from "./Metrics";
import Plan from "./Plan";
import Review from "./Review";
import Settings from "./Settings";
import Stats from "./Stats";
import Today from "./Today";

type Tab = "today" | "history" | "stats" | "plan";
type Overlay = { k: "settings" } | { k: "metrics" } | { k: "review"; ym: string } | null;
const TABS: [Tab, string][] = [["today", "Today"], ["history", "History"], ["stats", "Stats"], ["plan", "Plan"]];  // the tab key is also its icon name

export default function Shell({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>("today");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const s = useStore();
  const L = useLedger();
  const today = useToday();
  const opened = useRef(false);

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
  if (overlay?.k === "review") return <><Review ym={overlay.ym} onClose={() => setOverlay(null)} onPlan={() => { setOverlay(null); setTab("plan"); }} /><ToastHost /></>;

  return (
    <div className="app">
      {s.status === "offline" && <div className="notice" role="status" style={{ borderRadius: 0, textAlign: "center" }}>Offline. Showing what was last synced. Saving needs a connection.</div>}
      {tab === "today" && <Today onSettings={() => setOverlay({ k: "settings" })} onReview={(ym) => setOverlay({ k: "review", ym })} />}
      {tab === "history" && <History />}
      {tab === "stats" && <Stats />}
      {tab === "plan" && <Plan onReview={(ym) => setOverlay({ k: "review", ym })} />}
      <ToastHost />
      <div className="tabs"><nav aria-label={APP_NAME}>
        {TABS.map(([k, label]) => <button key={k} className="tab" aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><Icon name={k} size={22} /><span>{label}</span></button>)}
      </nav></div>
    </div>
  );
}
