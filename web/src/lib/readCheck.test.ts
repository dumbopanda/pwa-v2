import { describe, expect, it } from "vitest";
import { readCheckProps } from "./readCheck";
import { emptyDraft } from "./entryRows";
import type { Account, Category } from "./types";

const a: Account = { id: "u", client_uid: "u", name: "UPI bank", currency: "INR", sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" };
const c: Category = { id: "f", client_uid: "f", name: "Food", sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" };
const n = { accountById: new Map([["u", a]]), categoryById: new Map([["f", c]]) };

describe("readCheckProps", () => {
  it("keeps said / read / saved by name", () => {
    const d = { ...emptyDraft("2026-11-20", "u"), amount: "340", name: "swiggy", categoryId: "f" };
    const p = readCheckProps("swiggy 340 upi", "edited", "rules", "2026-11-20", d, { ...d, amount: "360" }, n);
    expect(p.read).toMatchObject({ amt: "340", acc: "UPI bank", cat: "Food", name: "swiggy", dir: "spent" });
    expect(p.saved?.amt).toBe("360");
  });
  it("cuts balances and stays under 1000 bytes even for long Hindi text", () => {
    expect(readCheckProps("Rs 500 debited. Avl Bal Rs 12,345.00", "rejected", "ai", "2026-11-20", null, null, n).said).not.toMatch(/12,345/);
    const p = readCheckProps("चाय ".repeat(200), "rejected", "ai", "2026-11-20", null, null, n);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(1000);
  });
});
