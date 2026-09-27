export type NavLink = {
  name: string;
  /** Null until the section or page it points at exists. */
  href: string | null;
};

export const NAV_LINKS: readonly NavLink[] = [
  { name: "Explore", href: "#protocols" },
  { name: "How it works", href: "#how-it-works" },
  { name: "Protocols", href: "#protocols" },
  { name: "Developers", href: null },
  { name: "Security", href: "#security" },
];

/** No deployment and no docs site yet, so both are rendered as buttons. */
export const DOCS_HREF: string | null = null;
export const APP_HREF: string | null = null;
