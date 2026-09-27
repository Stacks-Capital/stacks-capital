import { useState } from "react";
import { PROTOCOLS } from "../data/protocols.ts";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.ts";
import { SectionHeading } from "./SectionHeading.tsx";

export function Protocols() {
  const [active, setActive] = useState(0);
  const reduced = usePrefersReducedMotion();

  return (
    <section id="protocols" className="shell">
      <SectionHeading
        eyebrow="Verified protocols"
        eyebrowColor="var(--color-purple)"
        width={620}
        title="stacks.capital integrates deployed contracts, not black boxes."
      />

      {/* Below 720px the panels stack, because a vertical label in a 76px column is unreadable. */}
      <div className="flex flex-col gap-2.5 max-md:h-auto md:h-[440px] md:flex-row md:overflow-x-auto">
        {PROTOCOLS.map((protocol, index) => {
          const isActive = index === active;
          return (
            <button
              key={protocol.name}
              type="button"
              aria-expanded={isActive}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={() => setActive(index)}
              className="protocol-panel relative flex cursor-pointer flex-col justify-between gap-4 overflow-hidden rounded-[22px] p-[26px] text-left"
              style={
                {
                  background: protocol.bg,
                  color: protocol.fg,
                  "--panel-flex": isActive ? "5 1 0" : "1 1 0",
                  "--panel-min-width": isActive ? "340px" : "76px",
                  "--panel-transition": reduced
                    ? "none"
                    : "flex 0.5s var(--ease-panel), min-width 0.5s var(--ease-panel)",
                } as React.CSSProperties
              }
            >
              <span className="text-[13px] font-extrabold opacity-70">{String(index + 1).padStart(2, "0")}</span>

              {!isActive ? (
                <span className="display text-2xl font-bold whitespace-nowrap max-md:[writing-mode:horizontal-tb] md:[writing-mode:vertical-rl] md:rotate-180">
                  {protocol.name}
                </span>
              ) : (
                <div className="max-w-[440px]">
                  <div className="display mb-4 text-[clamp(32px,3.6vw,48px)] leading-[1.05] font-black">
                    {protocol.name}
                  </div>
                  <p className="m-0 mb-[22px] text-base leading-[1.55] opacity-85">{protocol.capabilities}</p>
                  <div className="flex flex-wrap gap-2">
                    {protocol.capNames.map((cap) => (
                      <span
                        key={cap}
                        className="rounded-full border px-3.5 py-[7px] text-[13px] font-bold"
                        style={{
                          borderColor:
                            protocol.fg === "var(--color-ink)" ? "rgba(23,23,29,0.35)" : "rgba(255,253,248,0.45)",
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
