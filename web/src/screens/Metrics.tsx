import Icon from "../Icon";
import { useEffect, useState } from "react";
import { supabase } from "../supabase";

type M = {
  users: number; entries_per_user_day: number | null; days_with_entry_per_week: number | null;
  streak: { avg: number | null; max: number | null; users: number }; open_to_save_ms_median: number | null;
  ai_outcomes_30d: Record<string, number>; retention: Record<string, { eligible: number; returned: number }>; review_opened_90d: { times: number; users: number };
};

/** Owner only. The database refuses anyone else, so this page shows nothing to other users. */
export default function Metrics({ onBack }: { onBack: () => void }) {
  const [m, setM] = useState<M | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { supabase.rpc("admin_metrics").then((r) => (r.error ? setErr(true) : setM(r.data as M))); }, []);
  const ai = m?.ai_outcomes_30d ?? {}; const aiN = (ai.accepted ?? 0) + (ai.edited ?? 0) + (ai.rejected ?? 0);
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
  const Row = ({ k, v }: { k: string; v: string | number | null | undefined }) => <div className="row"><span className="grow">{k}</span><b>{v ?? "–"}</b></div>;

  return (
    <main className="screen stack">
      <div className="row"><button className="iconbtn" aria-label="Back" onClick={onBack}><Icon name="back" /></button><h1>Usage metrics</h1></div>
      {err && <p className="error">Not available.</p>}
      {m && (
        <>
          <section className="card stack"><Row k="Users" v={m.users} />
            <Row k="Entries per user per active day (30d)" v={m.entries_per_user_day} />
            <Row k="Days with an entry per user per week (8w)" v={m.days_with_entry_per_week} />
            <Row k="Streak, latest per user (avg / max)" v={`${m.streak.avg ?? "–"} / ${m.streak.max ?? "–"}`} />
            <Row k="Time from app open to first saved entry (median)" v={m.open_to_save_ms_median === null ? null : `${(m.open_to_save_ms_median / 1000).toFixed(1)} s`} /></section>
          <section className="card stack"><b>AI confirm rate (30d, {aiN} reads)</b>
            <Row k="Accepted unchanged" v={pct(ai.accepted ?? 0, aiN)} /><Row k="Edited" v={pct(ai.edited ?? 0, aiN)} /><Row k="Rejected" v={pct(ai.rejected ?? 0, aiN)} /></section>
          <section className="card stack"><b>Return (came back on or after day N)</b>
            {["d1", "d7", "d30"].map((d) => <Row key={d} k={`Day ${d.slice(1)}`} v={m.retention[d] ? `${pct(m.retention[d].returned, m.retention[d].eligible)} of ${m.retention[d].eligible}` : "–"} />)}</section>
          <section className="card stack"><Row k="Month-end review opened (90d)" v={`${m.review_opened_90d.times} times, ${m.review_opened_90d.users} users`} /></section>
        </>
      )}
    </main>
  );
}
