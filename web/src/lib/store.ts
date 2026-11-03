// The app's data. Reads come from memory, backed by an IndexedDB snapshot so
// the last-synced data opens offline. Writes need a connection (v1 has no
// offline queue); after a write the new rows are merged in at once.
import { useSyncExternalStore } from "react";
import { supabase } from "../supabase";
import { todayLocal } from "./ids";
import type { Account, Budget, Category, Entry } from "./types";

type Cursor = { ts: string | null; id: string | null };
export type State = {
  userId: string | null;
  ready: boolean;                 // a snapshot or a first pull has landed
  status: "idle" | "syncing" | "offline";
  accounts: Account[]; categories: Category[]; entries: Entry[]; budgets: Budget[];
  noSpend: string[];              // dates marked "I spent nothing"
  currency: string;               // profile currency (budgets use it)
  firstDay: string;               // the day you started: streak and "missed" never look before it
  cursors: { accounts: Cursor; categories: Cursor; entries: Cursor };
};

const blank = (): State => ({
  userId: null, ready: false, status: "idle", accounts: [], categories: [], entries: [], budgets: [], noSpend: [],
  currency: "INR", firstDay: "", cursors: { accounts: { ts: null, id: null }, categories: { ts: null, id: null }, entries: { ts: null, id: null } },
});

let state = blank();
const subs = new Set<() => void>();
export const getState = () => state;
export function setState(p: Partial<State>) { state = { ...state, ...p }; subs.forEach((f) => f()); }
export const useStore = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getState);

// ---- IndexedDB snapshot (one record per user) ----
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("app", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => { const q = f(db.transaction("kv", mode).objectStore("kv")); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
const SNAP = (u: string) => `snap:${u}`;
// ponytail: the whole ledger is one JSON snapshot. Fine to tens of thousands of rows; move to per-store records past that.
async function saveSnapshot() {
  if (!state.userId) return;
  const { accounts, categories, entries, budgets, noSpend, currency, firstDay, cursors } = state;
  try { await kv("readwrite", (s) => s.put({ accounts, categories, entries, budgets, noSpend, currency, firstDay, cursors }, SNAP(state.userId!))); } catch { /* private mode: run without a cache */ }
}

export async function openUser(userId: string) {
  state = { ...blank(), userId };
  try {
    const snap = await kv<Partial<State> | undefined>("readonly", (s) => s.get(SNAP(userId)));
    if (snap?.entries) state = { ...state, ...snap, userId, ready: true, status: "idle" };
  } catch { /* no cache */ }
  setState({});
}
export async function closeUser(wipe: boolean) {
  const u = state.userId;
  if (wipe && u) { try { await kv("readwrite", (s) => s.delete(SNAP(u))); } catch { /* ignore */ } }
  state = blank(); setState({});
}

// ---- pull ----
const merge = <T extends { id: string }>(old: T[], inc: T[]): T[] => {
  if (!inc.length) return old;
  const m = new Map(old.map((x) => [x.id, x]));
  for (const x of inc) m.set(x.id, x);
  return [...m.values()];
};

async function pullAll<T extends { id: string; updated_at: string }>(fn: string, cur: Cursor): Promise<{ rows: T[]; cursor: Cursor }> {
  const rows: T[] = []; let c = cur;
  for (;;) {
    const { data, error } = await supabase.rpc(fn, { p_since: c.ts, p_since_id: c.id, p_limit: 500 });
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length) c = { ts: page[page.length - 1].updated_at, id: page[page.length - 1].id };
    if (page.length < 500) return { rows, cursor: c };
  }
}

let syncing: Promise<void> | null = null;
/** Pull everything new since the last cursors. Tombstones come through and are kept as deleted rows. */
export function sync(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!state.userId) return;
    setState({ status: "syncing" });
    try {
      const [a, c, e] = await Promise.all([
        pullAll<Account>("pull_accounts", state.cursors.accounts),
        pullAll<Category>("pull_categories", state.cursors.categories),
        pullAll<Entry>("pull_entries", state.cursors.entries),
      ]);
      const [b, d, p] = await Promise.all([
        supabase.from("budgets").select("id, month, category_id, amount_minor"),
        supabase.from("day_status").select("date, status"),
        supabase.from("profiles").select("currency, onboarded_at").eq("user_id", state.userId).maybeSingle(),
      ]);
      if (b.error || d.error) throw b.error ?? d.error;
      const entries = merge(state.entries, e.rows);
      const started = p.data?.onboarded_at as string | undefined;
      setState({
        accounts: merge(state.accounts, a.rows), categories: merge(state.categories, c.rows), entries,
        budgets: (b.data ?? []) as Budget[], noSpend: (d.data ?? []).filter((r) => r.status === "no_spend").map((r) => r.date as string),
        currency: (p.data?.currency as string | undefined)?.trim() || state.currency,
        firstDay: started ? todayLocal(new Date(started)) : state.firstDay,
        cursors: { accounts: a.cursor, categories: c.cursor, entries: e.cursor }, ready: true, status: "idle",
      });
      void saveSnapshot();
    } catch {
      setState({ status: "offline", ready: state.ready });
    }
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Merge rows a write just returned, so the screen updates before the next pull. */
export function applyLocal(p: { entries?: Entry[]; accounts?: Account[]; categories?: Category[]; budgets?: Budget[]; noSpend?: string[] }) {
  setState({
    entries: merge(state.entries, p.entries ?? []), accounts: merge(state.accounts, p.accounts ?? []),
    categories: merge(state.categories, p.categories ?? []), budgets: p.budgets ?? state.budgets, noSpend: p.noSpend ?? state.noSpend,
  });
  void saveSnapshot();
}
