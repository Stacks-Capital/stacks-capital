import { LIFECYCLE, STEP_COLORS } from "../data/lifecycle.ts";
import { useAutoAdvance } from "../hooks/useAutoAdvance.ts";
import { SectionHeading } from "./SectionHeading.tsx";

const FALLBACK = "var(--color-purple)";

function colorAt(index: number): string {
  return STEP_COLORS[index % STEP_COLORS.length] ?? FALLBACK;
}

export function Lifecycle() {
  const [current, select] = useAutoAdvance(LIFECYCLE.length, 4000);
  const active = LIFECYCLE[current];
  const activeColor = colorAt(current);

  if (!active) return null;

  return (
    <section id="how-it-works" className="border-y border-ink/8 bg-paper">
      <div className="shell">
        <SectionHeading
          eyebrow="Shared transaction lifecycle"
          eyebrowColor="var(--color-orange)"
          width={620}
          title="Every action follows the same eight steps."
          body="Whether you're swapping, staking or supplying, stacks.capital explains, simulates and reviews before your wallet ever signs."
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-stretch gap-10">
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {LIFECYCLE.map((step, index) => {
              const isActive = index === current;
              const done = index < current;
              return (
                <li key={step.n}>
                  <button
                    type="button"
                    onClick={() => select(index)}
                    aria-current={isActive ? "step" : undefined}
                    className={`flex w-full cursor-pointer items-center gap-4 rounded-xl px-[18px] py-3.5 text-left transition-colors hover:bg-ink/5 ${
                      isActive ? "bg-ink/6" : "bg-transparent"
                    }`}
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold transition-all"
                      style={{
                        background: isActive ? activeColor : done ? "rgba(23,23,29,0.85)" : "rgba(23,23,29,0.07)",
                        color: isActive || done ? "var(--color-paper)" : "rgba(23,23,29,0.5)",
                      }}
                    >
                      {step.n}
                    </span>
                    <span
                      className={`text-base transition-colors ${
                        isActive ? "font-extrabold text-ink" : "font-semibold text-ink/55"
                      }`}
                    >
                      {step.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="relative flex min-h-[360px] flex-col justify-between overflow-hidden rounded-3xl bg-ink p-[clamp(28px,4vw,48px)]">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-20 -right-20 size-60 rounded-full opacity-35 blur-[30px] transition-colors duration-400"
              style={{ background: activeColor }}
            />
            <div className="relative">
              <div className="mb-6 text-[13px] font-bold tracking-[0.08em] text-paper/50 uppercase">
                Step {active.n} of 08
              </div>
              <div className="display mb-[18px] text-[clamp(36px,4.5vw,56px)] leading-[1.05] font-black text-paper">
                {active.name}
              </div>
              <p className="m-0 max-w-[460px] text-lg leading-relaxed text-paper/72">{active.desc}</p>
            </div>

            <div className="relative mt-9 flex gap-1.5">
              {LIFECYCLE.map((step, index) => (
                <div
                  key={step.n}
                  className="h-1 flex-1 rounded-full transition-colors duration-300"
                  style={{ background: index <= current ? activeColor : "rgba(255,253,248,0.15)" }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
