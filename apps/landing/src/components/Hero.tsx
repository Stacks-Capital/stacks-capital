import { HERO_ALLOCATION } from "../data/appPreview.ts";

const TRUST = [
  { title: "Non-custodial", sub: "Your wallet signs every action" },
  { title: "Evidence labeled", sub: "Rates, limits and risks show their source" },
  { title: "Built on Stacks", sub: "sBTC, Zest, Bitflow, Hermetica and Granite" },
];

export function Hero() {
  return (
    <div id="top" className="relative overflow-hidden border-t border-paper/10 bg-ink">
      {/* Decorative only: the orbs belong to the hero, never behind the nav. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-10 -right-20 size-[480px] rounded-full opacity-90 blur-[2px]"
        style={{ background: "radial-gradient(circle at 35% 30%, var(--color-purple-light), var(--color-purple))" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[60px] right-[220px] size-[340px] rounded-full opacity-90"
        style={{ background: "radial-gradient(circle at 35% 30%, var(--color-orange-light), var(--color-orange))" }}
      />

      <div className="shell-wide relative z-2 grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-center gap-10 pt-[clamp(24px,6vw,64px)] pb-[clamp(80px,10vw,140px)]">
        <div>
          <p className="mb-5 text-[13px] font-extrabold tracking-[0.12em] text-yellow uppercase">
            One place for Bitcoin DeFi on Stacks
          </p>
          <h1 className="display m-0 mb-6 max-w-[560px] text-[clamp(40px,5.2vw,64px)] leading-[1.05] font-black text-paper">
            Put your Bitcoin capital to <span className="text-orange">work.</span>
          </h1>
          <p className="m-0 mb-8 max-w-[540px] text-lg leading-relaxed text-paper/75">
            Move from BTC to verified on-chain opportunities without stitching together five different apps. Compare
            yield, borrow, swap, provide liquidity and track risk&mdash;while your wallet stays in control.
          </p>

          <div className="mb-10 flex flex-wrap gap-3.5">
            <a
              href="#protocols"
              className="rounded-full bg-orange px-6 py-3.5 text-[15px] font-extrabold text-ink transition-colors hover:bg-orange-hover"
            >
              Explore opportunities →
            </a>
            <a
              href="#evidence"
              className="rounded-full border border-paper/25 bg-paper/8 px-6 py-3.5 text-[15px] font-bold text-paper transition-colors hover:bg-paper/16"
            >
              See how verification works
            </a>
          </div>

          <div className="flex flex-wrap gap-10">
            {TRUST.map((item) => (
              <div key={item.title}>
                <div className="mb-1 text-base font-extrabold text-paper">{item.title}</div>
                <div className="text-[13px] text-paper/55">{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <AllocationCard />
      </div>
    </div>
  );
}

function AllocationCard() {
  return (
    <div className="relative z-3 mx-auto w-full max-w-[400px] rotate-4 rounded-[20px] bg-paper p-6 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
      <div className="mb-2 text-[11px] font-extrabold tracking-[0.08em] text-ink/50 uppercase">Example allocation</div>
      <div className="mb-3.5 text-[30px] font-black">
        1.00 sBTC{" "}
        <span className="rounded-full bg-green/12 px-2.5 py-1 align-middle text-xs font-bold text-green-dark">
          4 verified routes
        </span>
      </div>

      <div className="mb-5 flex h-2 overflow-hidden rounded-full">
        {HERO_ALLOCATION.map((row) => (
          <div key={row.name} style={{ width: row.pct, background: row.color }} />
        ))}
      </div>

      {HERO_ALLOCATION.map((row) => (
        <div key={row.name} className="flex items-center justify-between border-t border-ink/8 py-3">
          <div>
            <div className="text-sm font-bold">{row.name}</div>
            <div className="text-xs text-ink/50">{row.sub}</div>
          </div>
          <div className="text-[15px] font-extrabold">{row.pct}</div>
        </div>
      ))}

      <div className="mt-3.5 rounded-xl bg-cream px-4 py-3.5">
        <div className="mb-0.5 text-[13px] font-extrabold">Every recommendation is explainable.</div>
        <div className="text-[12.5px] text-ink/65">Unsupported or stale data never becomes a number.</div>
      </div>
    </div>
  );
}
