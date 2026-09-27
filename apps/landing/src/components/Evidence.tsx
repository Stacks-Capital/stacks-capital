import { useState } from "react";
import { EVIDENCE_STATES } from "../data/evidenceStates.ts";
import { useAutoAdvance } from "../hooks/useAutoAdvance.ts";
import { SectionHeading } from "./SectionHeading.tsx";

export function Evidence() {
  const [current, select] = useAutoAdvance(EVIDENCE_STATES.length, 3000);
  // The reading level is a deliberate choice, so it persists and never resets the carousel.
  const [technical, setTechnical] = useState(false);
  const state = EVIDENCE_STATES[current];

  if (!state) return null;

  return (
    <section id="evidence" className="relative overflow-hidden bg-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute top-[40%] -left-[100px] size-[300px] rounded-full bg-purple opacity-25 blur-[40px]"
      />
      <div className="shell relative z-1">
        <SectionHeading
          eyebrow="The evidence promise"
          eyebrowColor="var(--color-yellow)"
          title="Numbers that can't lie by omission."
          onDark
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-center gap-[clamp(32px,5vw,64px)]">
          <div>
            <p className="mb-3.5 text-[13px] font-bold text-paper/50">Pick a data state to see how it's shown</p>
            <div className="mb-8 flex flex-wrap gap-2">
              {EVIDENCE_STATES.map((item, index) => {
                const selected = index === current;
                return (
                  <button
                    key={item.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => select(index)}
                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold transition-all ${
                      selected ? "border-paper bg-paper text-ink" : "border-paper/20 bg-transparent text-paper/80"
                    }`}
                  >
                    <span className="size-2 rounded-full" style={{ background: item.color }} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div
              className="mb-3 text-xs font-extrabold tracking-[0.08em] uppercase transition-colors duration-300"
              style={{ color: state.color }}
            >
              The rule
            </div>
            <p className="display m-0 text-[clamp(22px,2.4vw,28px)] leading-[1.35] text-paper">{state.rule}</p>
          </div>

          <div className="rounded-3xl bg-paper p-7 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-[22px] flex flex-wrap items-center justify-between gap-3">
              <div className="text-[15px] font-extrabold">{state.title}</div>
              <div className="flex rounded-full bg-canvas p-[3px]">
                {[
                  { label: "Simple", value: false },
                  { label: "Technical", value: true },
                ].map((mode) => (
                  <button
                    key={mode.label}
                    type="button"
                    aria-pressed={technical === mode.value}
                    onClick={() => setTechnical(mode.value)}
                    className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${
                      technical === mode.value ? "bg-ink text-paper" : "bg-transparent text-ink/60"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-2 flex flex-wrap items-baseline gap-3.5">
              <div
                className="text-[clamp(44px,5vw,60px)] font-extrabold tracking-[-0.02em] transition-colors duration-300"
                style={{ color: state.valueColor, textDecoration: state.struck ? "line-through" : "none" }}
              >
                {state.value}
              </div>
              <span
                className="rounded-full px-3 py-[5px] text-[12.5px] font-extrabold"
                style={{ background: state.badgeBg, color: state.badgeFg }}
              >
                {state.label}
              </span>
            </div>
            <div className="mb-[22px] text-[13.5px] text-ink/55">{state.sub}</div>

            {technical ? (
              <div className="rounded-2xl bg-ink px-[18px] py-1.5 font-mono">
                {state.meta.map((row) => (
                  <div
                    key={row.k}
                    className="flex justify-between gap-4 border-b border-paper/8 py-2.5 text-[12.5px] last:border-b-0"
                  >
                    <span className="text-paper/50">{row.k}</span>
                    <span className="text-right text-paper">{row.v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-canvas px-[18px] py-4 text-[15px] leading-[1.55]">{state.plain}</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
