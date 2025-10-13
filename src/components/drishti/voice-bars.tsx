/**
 * Tiny animated equalizer bars — decorative voice-activity indicator.
 * Bars pulse via the shared `drishti-bar` keyframes; color follows `text-*`.
 */
export function VoiceBars({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-3.5 items-end gap-[2.5px] ${className}`}
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="drishti-bar w-[3px] rounded-full bg-current"
          style={{ height: "100%", animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </span>
  );
}
