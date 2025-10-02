/**
 * Fixed ambient background — soft aurora glows + faint grid.
 * Pure decoration; sits behind all content and never captures pointers.
 */
export function AmbientBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Aurora glows */}
      <div className="drishti-aurora-a absolute -top-48 left-1/2 h-[30rem] w-[46rem] max-w-none -translate-x-1/2 rounded-full bg-amber-500/10 blur-[110px]" />
      <div className="drishti-aurora-b absolute -right-32 bottom-[-10rem] h-[26rem] w-[34rem] rounded-full bg-orange-600/10 blur-[100px]" />
      <div className="drishti-aurora-b absolute -left-40 top-1/3 hidden h-[24rem] w-[24rem] rounded-full bg-rose-500/[0.07] blur-[100px] lg:block" />
      {/* Faint engineering grid */}
      <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:44px_44px]" />
    </div>
  );
}
