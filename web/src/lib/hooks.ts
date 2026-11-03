import { useEffect, useMemo, useState } from "react";
import { todayLocal } from "./ids";
import { loggedDatesOf } from "./ledger";
import { useStore } from "./store";
import type { Account, Category } from "./types";

/** Today's local date; flips over at midnight even if the app stays open. */
export function useToday(): string {
  const [t, setT] = useState(todayLocal());
  useEffect(() => {
    const f = () => setT(todayLocal());
    const i = setInterval(f, 30_000);
    document.addEventListener("visibilitychange", f);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", f); };
  }, []);
  return t;
}

const bySort = <T extends { sort_order: number; name: string }>(a: T, b: T) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/** The synced ledger, split into what's live and what's pickable. */
export function useLedger() {
  const s = useStore();
  return useMemo(() => {
    const accounts = s.accounts.filter((a) => !a.deleted_at).sort(bySort);
    const categories = s.categories.filter((c) => !c.deleted_at).sort(bySort);
    const entries = s.entries.filter((e) => !e.deleted_at);
    return {
      s, accounts, categories, entries,
      activeAccounts: accounts.filter((a) => !a.archived_at) as Account[],
      activeCategories: categories.filter((c) => !c.archived_at) as Category[],
      accountById: new Map(s.accounts.map((a) => [a.id, a])),
      categoryById: new Map(s.categories.map((c) => [c.id, c])),
      loggedDates: loggedDatesOf(entries),
      noSpend: new Set(s.noSpend),
    };
  }, [s.accounts, s.categories, s.entries, s.noSpend, s]);
}
