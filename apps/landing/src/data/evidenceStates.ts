export type EvidenceMeta = { k: string; v: string };

export type EvidenceState = {
  label: string;
  /** The dot on the chip and the colour the rule heading takes. */
  color: string;
  badgeBg: string;
  badgeFg: string;
  title: string;
  value: string;
  valueColor: string;
  struck: boolean;
  sub: string;
  rule: string;
  /** Plain English, for someone who has never read a block explorer. */
  plain: string;
  /** The same claim as metadata, for someone who wants the provenance. */
  meta: readonly EvidenceMeta[];
};

export const EVIDENCE_STATES: readonly EvidenceState[] = [
  {
    label: "Verified",
    color: "var(--color-green)",
    badgeBg: "rgba(31,157,85,0.14)",
    badgeFg: "var(--color-green-dark)",
    title: "Zest · sBTC supply rate",
    value: "4.21%",
    valueColor: "var(--color-ink)",
    struck: false,
    sub: "Variable supply rate",
    rule: "Every price, rate and liquidity datum carries source, timestamp/block and confidence state.",
    plain: "Read directly from Zest a few seconds ago. You can rely on this number.",
    meta: [
      { k: "source", v: "zest · pool contract" },
      { k: "read", v: "canonical" },
      { k: "block", v: "#182,441" },
      { k: "confidence", v: "verified" },
    ],
  },
  {
    label: "Provider-reported",
    color: "var(--color-yellow)",
    badgeBg: "rgba(255,209,102,0.3)",
    badgeFg: "var(--color-amber-deep)",
    title: "Hermetica · sUSDh rewards",
    value: "7.80%",
    valueColor: "var(--color-ink)",
    struck: false,
    sub: "Reported by provider",
    rule: "Provider-reported returns remain labeled and cannot become verified through repetition.",
    plain:
      "This figure comes from Hermetica itself. We show it, but keep it labeled so you know we haven’t confirmed it.",
    meta: [
      { k: "source", v: "provider-reported" },
      { k: "read", v: "off-chain" },
      { k: "confidence", v: "labeled" },
      { k: "verified", v: "false" },
    ],
  },
  {
    label: "Stale",
    color: "var(--color-orange)",
    badgeBg: "rgba(255,112,72,0.16)",
    badgeFg: "var(--color-orange-text)",
    title: "Bitflow · pool liquidity",
    value: "$2.4M",
    valueColor: "rgba(23,23,29,0.35)",
    struck: true,
    sub: "Last read 38 minutes ago",
    rule: "Unknown, unsupported, stale and disputed are explicit states—not zero.",
    plain: "This data is too old to act on. We refresh it before you can get a quote.",
    meta: [
      { k: "source", v: "bitflow · pool contract" },
      { k: "block", v: "#182,262" },
      { k: "age", v: "38m" },
      { k: "confidence", v: "stale" },
    ],
  },
  {
    label: "Unsupported",
    color: "rgba(255,253,248,0.5)",
    badgeBg: "rgba(23,23,29,0.07)",
    badgeFg: "rgba(23,23,29,0.65)",
    title: "Granite · 30-day projection",
    value: "—",
    valueColor: "rgba(23,23,29,0.35)",
    struck: false,
    sub: "No usable evidence",
    rule: "Recommendations require both usable return evidence and deployable-capacity evidence.",
    plain:
      "We don’t have trustworthy data here, so we show nothing instead of guessing. It’s left out of recommendations.",
    meta: [
      { k: "source", v: "none" },
      { k: "value", v: "null (not 0)" },
      { k: "recommendable", v: "false" },
      { k: "confidence", v: "unsupported" },
    ],
  },
  {
    label: "History",
    color: "var(--color-purple)",
    badgeBg: "rgba(108,85,217,0.14)",
    badgeFg: "var(--color-purple-text)",
    title: "Your earned yield",
    value: "0.0042 sBTC",
    valueColor: "var(--color-ink)",
    struck: false,
    sub: "From reconciled cash flows",
    rule: "Historical charts contain canonical observations only; earned yield requires reconciled cash flows.",
    plain: "Only what actually happened on-chain counts. No filled-in or estimated points on your charts.",
    meta: [
      { k: "observations", v: "canonical only" },
      { k: "synthetic points", v: "0" },
      { k: "cash flows", v: "reconciled" },
      { k: "confidence", v: "verified" },
    ],
  },
];
