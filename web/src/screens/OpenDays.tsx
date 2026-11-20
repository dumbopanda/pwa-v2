import Icon from "../Icon";
import { useLedger, useToday } from "../lib/hooks";
import { addDays, daysInMonth, monthOf, openPastDays } from "../lib/ledger";
import { monthLabel } from "../lib/reviewFacts";

/** The month a review should be offered for: the last 3 days of a month, and the first 5 of the next. */
export function reviewMonth(today: string): string | null {
  const ym = monthOf(today), day = Number(today.slice(8));
  if (day >= daysInMonth(ym) - 2) return ym;
  if (day <= 5) return monthOf(addDays(`${ym}-01`, -1));
  return null;
}

const short = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
const mon = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

/**
 * Top of the dashboard: past days still open (red, only when there are some;
 * today never counts), and the month-end review when it is ready.
 */
export default function OpenDays({ onShow, onReview }: { onShow: () => void; onReview: (ym: string) => void }) {
  const L = useLedger();
  const today = useToday();
  const open = openPastDays(today, L.closed, L.start);
  const review = reviewMonth(today);
  const at = (d: string) => new Date(`${d}T00:00:00Z`);
  const first = open.slice(0, 3).reverse();
  const list = first.map((d) => short.format(at(d))).join(", ") + (open.length <= 3 ? ` ${mon.format(at(open[0]))}` : ` and ${open.length - 3} more`);
  return (
    <>
      {open.length > 0 && (
        <button className="opencard" onClick={onShow}>
          <span className="dot" aria-hidden="true" />
          <span className="grow"><b>{open.length} {open.length === 1 ? "day" : "days"} still open</b><span className="muted">{list}. Add what's missing and close {open.length === 1 ? "it" : "them"}.</span></span>
          <Icon name="next" size={20} />
        </button>
      )}
      {review && L.entries.length > 0 && (
        <button className="card item banner" onClick={() => onReview(review)}>
          <span className="grow"><b>Your {monthLabel(review)} review is ready</b><br /><span className="muted small">See where the money went and plan the next month.</span></span><Icon name="next" />
        </button>
      )}
    </>
  );
}
