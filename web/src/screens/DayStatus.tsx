import Icon from "../Icon";
import { useLedger, useToday } from "../lib/hooks";
import { addDays, daysInMonth, monthOf } from "../lib/ledger";
import { monthLabel } from "../lib/reviewFacts";

/** The month a review should be offered for: the last 3 days of a month, and the first 5 of the next. */
export function reviewMonth(today: string): string | null {
  const ym = monthOf(today), day = Number(today.slice(8));
  if (day >= daysInMonth(ym) - 2) return ym;
  if (day <= 5) return monthOf(addDays(`${ym}-01`, -1));
  return null;
}

/** Top of the dashboard at a month's turn: "Your November review is ready". Nothing the rest of the month. */
export default function DayStatus({ onReview }: { onReview: (ym: string) => void }) {
  const L = useLedger();
  const review = reviewMonth(useToday());
  if (!review || L.entries.length === 0) return null;
  return (
    <button className="card item banner" onClick={() => onReview(review)}>
      <span className="grow"><b>Your {monthLabel(review)} review is ready</b><br /><span className="muted small">See where the money went and plan the next month.</span></span><Icon name="next" />
    </button>
  );
}
