/**
 * The Talvex logo mark. PLACEHOLDER by design: an accent gradient tile with
 * a three quarter ring, a quiet monitoring motif from the design handoff
 * (docs/design/README.md). When the real logo exists, swap the internals of
 * this component; every screen renders the mark through here.
 */
export function LogoMark({ size = 48 }: { size?: number }) {
  // Reference geometry at 48px: 14px tile radius, 16px ring, 2.5px stroke.
  // Everything scales proportionally so header sized marks stay balanced.
  const radius = Math.round((size * 14) / 48);
  const ring = Math.round((size * 16) / 48);
  const stroke = Math.max(1.5, (size * 2.5) / 48);

  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center shadow-(--shadow-tile)"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--accent-gradient)",
      }}
    >
      <div
        className="-rotate-45 rounded-full"
        style={{
          width: ring,
          height: ring,
          border: `${stroke}px solid var(--mark-ring)`,
          borderRightColor: "transparent",
        }}
      />
    </div>
  );
}
