// 30 built-in profile icons, five moods of six. No photos: nothing to upload, store or resize.
// Same 24 grid and 2px stroke as Icon.tsx. The keys are the ones the database allows (migration 0024).
const c = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const AVATAR_GROUPS: { name: string; items: [key: string, label: string, d: string][] }[] = [
  { name: "Calm", items: [
    ["moon", "Moon", "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"],
    ["leaf", "Leaf", "M5 19C5 10 10 5 20 5c0 10-5 14-14 14ZM5 19 14 10"],
    ["wave", "Wave", "M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"],
    ["cloud", "Cloud", "M7 18h10a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 7 9.5 4.3 4.3 0 0 0 7 18Z"],
    ["lotus", "Lotus", "M12 20c-3-3-3-9 0-15 3 6 3 12 0 15ZM12 20C8 20 4 17 3 11c4 0 7 2 9 6M12 20c4 0 8-3 9-9-4 0-7 2-9 6"],
    ["mountain", "Mountain", "M2 20 9 7l4 7 2.5-4L22 20Z"],
  ] },
  { name: "Bold", items: [
    ["flame", "Flame", "M12 22c-4 0-7-2.7-7-7 0-3 2-5.5 4-7.5 0 2 1 3 2 3 0-3 1-6 3-8 1 4 5 6 5 12 0 4.3-3 7.5-7 7.5Z"],
    ["bolt", "Bolt", "M13 2 4 14h7l-1 8 9-12h-7Z"],
    ["rocket", "Rocket", `M12 2c4 2 6 6 5 11l-3 3h-4l-3-3C6 8 8 4 12 2ZM9 16l-3 5 4-1M15 16l3 5-4-1${c(12, 9, 1.5)}`],
    ["shield", "Shield", "M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5Z"],
    ["crown", "Crown", "M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z"],
    ["medal", "Medal", `${c(12, 15, 5)}M8.5 11 6 3h5l1 4 1-4h5l-2.5 8`],
  ] },
  { name: "Curious", items: [
    ["compass", "Compass", `${c(12, 12, 10)}M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5Z`],
    ["telescope", "Telescope", "M3 12 16 6l2 5-13 6ZM10 15 8 21M13 14l3 7M16 6l1.5-3"],
    ["book", "Book", "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2ZM4 21V5M8 7h7"],
    ["bulb", "Idea", "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.6 1 1.3 1 2.1h5c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3Z"],
    ["puzzle", "Puzzle", "M10 3a2 2 0 1 1 4 0v2h5v5h-2a2 2 0 1 0 0 4h2v7h-7v-2a2 2 0 1 0-4 0v2H3v-7h2a2 2 0 1 0 0-4H3V5h7Z"],
    ["owl", "Owl", `M5 8c0-3 3-5 7-5s7 2 7 5v8c0 3-3 5-7 5s-7-2-7-5ZM5 8 3 5M19 8l2-3${c(9, 10, 2)}${c(15, 10, 2)}M11 14l1 2 1-2`],
  ] },
  { name: "Playful", items: [
    ["star", "Star", "M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.5 5.7 21l1.5-7L2 9.3l7-.8Z"],
    ["fox", "Fox", "M3 3l5 4h8l5-4-1 9-8 9-8-9ZM9 12v1M15 12v1M11.5 17h1"],
    ["panda", "Panda", `${c(12, 13, 8)}${c(5.5, 5.5, 2.5)}${c(18.5, 5.5, 2.5)}M9 12v.5M15 12v.5M11 16h2`],
    ["ghost", "Ghost", "M5 21V10a7 7 0 0 1 14 0v11l-3.5-2.5L12 21l-3.5-2.5ZM9.5 10v1M14.5 10v1"],
    ["cat", "Cat", "M4 3l4 4h8l4-4v10c0 5-3.5 8-8 8s-8-3-8-8ZM9 12v1M15 12v1M11 16l1 1 1-1"],
    ["paw", "Paw", `${c(7, 10, 2)}${c(12, 6, 2)}${c(17, 10, 2)}M12 12c-4 0-6 3-6 5.5 0 2 2 2.5 3.5 2 1-.4 1.7-.6 2.5-.6s1.5.2 2.5.6c1.5.5 3.5 0 3.5-2C18 15 16 12 12 12Z`],
  ] },
  { name: "Grounded", items: [
    ["tree", "Tree", "M12 22v-6M12 16c-4 0-7-3-7-6 0-3 3-4 4-5 1-2 5-2 6 0 1 1 4 2 4 5 0 3-3 6-7 6Z"],
    ["anchor", "Anchor", `${c(12, 5, 3)}M12 8v14M5 12H3c0 5 4 9 9 10 5-1 9-5 9-10h-2M8 12h8`],
    ["coffee", "Coffee", "M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 11h2a2.5 2.5 0 0 1 0 5h-2M8 2v3M12 2v3"],
    ["bike", "Bike", `${c(6, 16, 4)}${c(18, 16, 4)}M6 16l4-8h5l3 8M10 8l2 8M9 5h3`],
    ["home", "Home", "M3 11 12 3l9 8M5 9.5V21h14V9.5M10 21v-6h4v6"],
    ["key", "Key", `${c(8, 15, 5)}M11.5 11.5 21 2M17 6l3 3M15 8l2 2`],
  ] },
];

const PATH = new Map(AVATAR_GROUPS.flatMap((g) => g.items.map(([k, , d]) => [k, d] as const)));
export const AVATAR_LABEL = new Map(AVATAR_GROUPS.flatMap((g) => g.items.map(([k, l]) => [k, l] as const)));

/** The picked icon, or the person's initial (then "?") on lime when none is picked. */
export function Avatar({ avatar, name, size = 40 }: { avatar: string | null | undefined; name?: string | null; size?: number }) {
  const d = avatar ? PATH.get(avatar) : undefined;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} role="img" aria-label={avatar ? (AVATAR_LABEL.get(avatar) ?? "Avatar") : "Your initial"}>
      {d ? <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
        : (name?.trim().charAt(0).toUpperCase() || "?")}
    </span>
  );
}

/** All 30, in their five moods. Tap one to pick it; tap the picked one again to go back to the initial. */
export function AvatarGrid({ value, onPick }: { value: string | null; onPick: (key: string | null) => void }) {
  return (
    <div className="stack" style={{ gap: "var(--sp-4)" }}>
      {AVATAR_GROUPS.map((g) => (
        <div key={g.name} className="stack" style={{ gap: "var(--sp-2)" }}>
          <span className="caps">{g.name}</span>
          <div className="avgrid">
            {g.items.map(([k, label]) => (
              <button key={k} type="button" className="avpick" aria-label={label} aria-pressed={value === k} onClick={() => onPick(value === k ? null : k)}>
                <Avatar avatar={k} size={48} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
