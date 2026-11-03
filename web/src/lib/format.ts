const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "Tue, 3 Nov" from a YYYY-MM-DD. The date is a calendar day, so no time zone shifts it. */
export const dayLabel = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));
