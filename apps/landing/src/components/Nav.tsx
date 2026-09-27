import { useState } from "react";
import { APP_HREF, DOCS_HREF, NAV_LINKS } from "../data/nav.ts";
import { Cta } from "./Cta.tsx";
import { Wordmark } from "./Wordmark.tsx";

export function Nav() {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="bg-ink">
      <nav className="shell-wide flex flex-wrap items-center justify-between gap-6 py-7">
        <a href="#top" className="shrink-0">
          <Wordmark />
        </a>

        <div className="flex flex-wrap gap-1.5">
          {NAV_LINKS.map((link, index) => (
            <Cta
              key={link.name}
              href={link.href}
              onSelect={() => setActive(index)}
              className={`rounded-full px-4 py-[9px] text-[15px] font-semibold transition-colors hover:bg-paper/10 hover:text-paper ${
                index === active ? "bg-paper/15 text-paper" : "bg-transparent text-paper/75"
              }`}
            >
              {link.name}
            </Cta>
          ))}
        </div>

        <div className="flex gap-3">
          <Cta
            href={DOCS_HREF}
            className="rounded-full bg-paper px-5 py-[11px] text-sm font-bold text-ink transition-colors hover:bg-secondary-hover"
          >
            Read the docs
          </Cta>
          <Cta
            href={APP_HREF}
            className="rounded-full bg-orange px-5 py-[11px] text-sm font-bold text-ink transition-colors hover:bg-orange-hover"
          >
            Launch app ↗
          </Cta>
        </div>
      </nav>
    </div>
  );
}
