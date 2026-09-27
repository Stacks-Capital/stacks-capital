import { IN_SCOPE, OUT_OF_SCOPE } from "../data/appPreview.ts";
import { SectionHeading } from "./SectionHeading.tsx";

export function Scope() {
  return (
    <section id="security" className="border-t border-ink/8 bg-paper">
      <div className="shell">
        <SectionHeading
          eyebrow="Built on a clear boundary"
          eyebrowColor="var(--color-orange)"
          title="Orchestration and evidence. Not custody."
          body="stacks.capital integrates verified deployments of sBTC, Zest, Bitflow, Hermetica, Granite and supported stacking providers. Your wallet signs direct protocol transactions."
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-8">
          <div>
            <h3 className="mb-4 text-sm font-extrabold tracking-[0.06em] text-green uppercase">In scope</h3>
            <ul className="m-0 list-none p-0">
              {IN_SCOPE.map((item) => (
                <li key={item} className="flex gap-2.5 border-t border-ink/8 py-2.5 text-[14.5px] leading-[1.5]">
                  <span aria-hidden className="font-extrabold text-green">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-extrabold tracking-[0.06em] text-ink/45 uppercase">
              Explicitly out of scope
            </h3>
            <ul className="m-0 list-none p-0">
              {OUT_OF_SCOPE.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 border-t border-ink/8 py-2.5 text-[14.5px] leading-[1.5] text-ink/60"
                >
                  <span aria-hidden className="font-extrabold text-ink/35">
                    –
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
