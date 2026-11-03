export type Account = {
  id: string; client_uid: string; name: string; currency: string; sort_order: number;
  archived_at: string | null; deleted_at: string | null; updated_at: string;
};
export type Category = {
  id: string; client_uid: string; name: string; sort_order: number;
  archived_at: string | null; deleted_at: string | null; updated_at: string;
};
export type Entry = {
  id: string; client_uid: string; entry_date: string; txn_id: string; account_id: string;
  category_id: string | null; expense_name: string; more_info: string | null; txn_type: string;
  amount_minor: number; direction: "debit" | "credit"; transfer_group: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
};
export type Budget = { id: string; month: string; category_id: string | null; amount_minor: number };
export type DayStatus = { date: string; status: "open" | "logged" | "no_spend" };
