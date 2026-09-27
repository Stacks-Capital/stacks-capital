import { APP_HREF, DOCS_HREF } from "../data/nav.ts";
import { Cta } from "./Cta.tsx";
import { Wordmark } from "./Wordmark.tsx";

const FOOTER_LINKS: readonly { name: string; href: string | null }[] = [
  { name: "Protocols", href: "#protocols" },
  { name: "How it works", href: "#how-it-works" },
  { name: "Security", href: "#security" },
  { name: "Read the docs", href: DOCS_HREF },
];

export function FinalCta() {
  return (
    <footer className="bg-ink">
      <div className="mx-auto max-w-[1280px] px-8 pt-[clamp(56px,8vw,88px)] pb-10 text-center">
        <h2 className="display m-0 mb-6 text-[clamp(28px,4vw,44px)] font-black text-paper">
          Put your Bitcoin capital to <span className="text-orange">work.</span>
        </h2>
        <Cta
          href={APP_HREF}
          className="inline-block rounded-full bg-orange px-8 py-4 text-base font-extrabold text-ink transition-colors hover:bg-orange-hover"
        >
          Launch app ↗
        </Cta>
      </div>

      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-5 border-t border-paper/10 p-8">
        <Wordmark size="text-base" />
        <nav className="flex flex-wrap gap-6">
          {FOOTER_LINKS.map((link) => (
            <Cta key={link.name} href={link.href} className="text-sm text-paper/55 hover:text-paper">
              {link.name}
            </Cta>
          ))}
        </nav>
        <p className="m-0 text-[12.5px] text-paper/35">Stacks Capital · Bitcoin capital on Stacks</p>
      </div>
    </footer>
  );
}
