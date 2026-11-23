import Icon from "../Icon";
import { useEffect, useState } from "react";
import { Group, Page, ProfileFields, Row, toast, useAction } from "../components";
import { APP_NAME } from "../config";
import { useLedger } from "../lib/hooks";
import { Avatar, AvatarGrid } from "../lib/avatars";
import { filledCount, formToPatch, isFounder, toForm, type ProfForm, type Profile as P, type ProfPatch } from "../lib/profile";
import { THEMES, getTheme, setTheme, type Theme } from "../lib/theme";
import { supabase } from "../supabase";
import { AccountPage, AccountsPage, AddAccountPage, CategoriesPage, CategoryPage, DataPage, DeletePage } from "./Manage";

// The profile area, like a phone's settings: a hub of a few sections, each opening its own screen.
type Pg = { p: "hub" } | { p: "edit" } | { p: "avatar" } | { p: "accounts" } | { p: "account"; id: string } | { p: "addaccount" }
  | { p: "theme" } | { p: "categories" } | { p: "category"; id: string } | { p: "data" } | { p: "delete" };

export default function Profile({ profile, save, onClose, onMetrics }:
  { profile: P | null; save: (p: ProfPatch) => Promise<void>; onClose: () => void; onMetrics: () => void }) {
  const [stack, setStack] = useState<Pg[]>([{ p: "hub" }]);
  const page = stack[stack.length - 1];
  const push = (p: Pg) => setStack((s) => [...s, p]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  switch (page.p) {
    case "edit": return <Edit profile={profile} save={save} onAvatar={() => push({ p: "avatar" })} onBack={back} />;
    case "avatar": return <Pick profile={profile} save={save} onBack={back} />;
    case "accounts": return <AccountsPage onOpen={(id) => push({ p: "account", id })} onAdd={() => push({ p: "addaccount" })} onBack={back} />;
    case "account": return <AccountPage id={page.id} onBack={back} />;
    case "addaccount": return <AddAccountPage onBack={back} />;
    case "categories": return <CategoriesPage onOpen={(id) => push({ p: "category", id })} onBack={back} />;
    case "category": return <CategoryPage id={page.id} onBack={back} />;
    case "theme": return <ThemePage onBack={back} />;
    case "data": return <DataPage onBack={back} />;
    case "delete": return <DeletePage onBack={back} />;
    default: return <Hub profile={profile} onClose={onClose} onMetrics={onMetrics} go={push} />;
  }
}

function Hub({ profile, onClose, onMetrics, go }: { profile: P | null; onClose: () => void; onMetrics: () => void; go: (p: Pg) => void }) {
  const L = useLedger();
  const [admin, setAdmin] = useState(false);
  // The usage page only shows for the owner: the database says no to everyone else.
  useEffect(() => { supabase.rpc("admin_metrics").then((r) => setAdmin(!r.error), () => undefined); }, []);
  const live = (xs: { archived_at: string | null }[]) => xs.filter((x) => !x.archived_at).length;
  const filled = filledCount(profile);

  return (
    <Page title="Profile" onBack={onClose}>
      <div>
        {isFounder(profile) && (
          <div className="pstrip"><span>#{profile!.member_no} · Founding member</span><span>Free for life</span></div>
        )}
        <section className="pcard" aria-label="You">
          <button className="iconbtn dark pedit" aria-label="Edit profile" onClick={() => go({ p: "edit" })}><Icon name="edit" size={18} /></button>
          <Avatar avatar={profile?.avatar} name={profile?.display_name || profile?.email} size={80} />
          <span className={`pname${profile?.display_name ? "" : " empty"}`}>{profile?.display_name || "Add your name"}</span>
          {profile?.email && <span className="pmail">{profile.email}</span>}
          {filled < 4 && (
            <button className="pnudge" onClick={() => go({ p: "edit" })}><span>Add your details</span><span>{filled} of 4 ›</span></button>
          )}
        </section>
      </div>

      <Group label="Money">
        <Row icon="wallet" label="Accounts" value={String(live(L.accounts))} onClick={() => go({ p: "accounts" })} />
        <Row icon="tag" label="Categories" value={String(live(L.categories))} onClick={() => go({ p: "categories" })} />
      </Group>
      <Group label="App">
        <Row icon="theme" label="Theme" value={THEMES.find((t) => t.id === getTheme())!.label} onClick={() => go({ p: "theme" })} />
      </Group>
      <Group label="Your data">
        <Row icon="shield" label="Data & privacy" onClick={() => go({ p: "data" })} />
        {admin && <Row icon="stats" label="Usage metrics" onClick={onMetrics} />}
      </Group>
      <Group>
        <Row icon="logout" label="Sign out" onClick={() => supabase.auth.signOut()} />
        <Row icon="trash" label="Delete my account" danger onClick={() => go({ p: "delete" })} />
      </Group>
      <p className="muted small" style={{ textAlign: "center", margin: 0 }}>{APP_NAME}</p>
    </Page>
  );
}

function ThemePage({ onBack }: { onBack: () => void }) {
  const [t, setT] = useState<Theme>(getTheme);
  return (
    <Page title="Theme" onBack={onBack}>
      <div className="seg" role="group" aria-label="Theme">
        {THEMES.map((x) => <button key={x.id} aria-pressed={t === x.id} onClick={() => { setTheme(x.id); setT(x.id); }}>{x.label}</button>)}
      </div>
      <p className="caption">System follows your device.</p>
    </Page>
  );
}

function Edit({ profile, save, onAvatar, onBack }: { profile: P | null; save: (p: ProfPatch) => Promise<void>; onAvatar: () => void; onBack: () => void }) {
  const { busy, error, run, setError } = useAction();
  const [f, setF] = useState<ProfForm>(() => toForm(profile));
  const done = () => {
    const r = formToPatch(f);
    if ("error" in r) return setError(r.error);
    void run(async () => { await save(r.patch); toast("Saved"); onBack(); });
  };
  return (
    <Page title="Edit profile" onBack={onBack}>
      <button className="stack" style={{ alignItems: "center", gap: "var(--sp-2)", border: 0, background: "none", cursor: "pointer", padding: 0 }} onClick={onAvatar} aria-label="Change icon">
        <Avatar avatar={profile?.avatar} name={f.display_name || profile?.email} size={96} />
        <span className="btn quiet">Change icon</span>
      </button>
      <section className="card stack">
        <ProfileFields f={f} set={(p) => setF({ ...f, ...p })} />
        <p className="muted small" style={{ margin: 0 }}>Optional. Only you see this. It helps us make the app fit people like you.</p>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="pagefoot stack"><button className="btn primary" style={{ width: "100%" }} disabled={busy} onClick={done}>{busy ? "Saving…" : "Save"}</button></div>
    </Page>
  );
}

function Pick({ profile, save, onBack }: { profile: P | null; save: (p: ProfPatch) => Promise<void>; onBack: () => void }) {
  const { error, run } = useAction();
  return (
    <Page title="Choose your icon" onBack={onBack}>
      <AvatarGrid value={profile?.avatar ?? null} onPick={(avatar) => void run(async () => { await save({ avatar }); onBack(); })} />
      {error && <p className="error" role="alert">{error}</p>}
    </Page>
  );
}
