export type LifecycleStep = { n: string; name: string; desc: string };

/** The four accents the steps cycle through, in order. */
export const STEP_COLORS: readonly string[] = [
  "var(--color-purple)",
  "var(--color-orange)",
  "var(--color-amber-step)",
  "var(--color-green)",
];

export const LIFECYCLE: readonly LifecycleStep[] = [
  { n: "01", name: "Choose", desc: "Pick a supported action across sBTC, Zest, Bitflow, Hermetica or Granite." },
  { n: "02", name: "Quote", desc: "Quotes are informational, not binding." },
  { n: "03", name: "Review", desc: "The plan binds expiry, network, registry, adapter and deployment versions." },
  {
    n: "04",
    name: "Wallet sign",
    desc: "Your wallet signs the transaction directly. stacks.capital never holds keys.",
  },
  { n: "05", name: "Submit", desc: "The signed plan is submitted to the protocol." },
  { n: "06", name: "Confirm", desc: "The transaction confirms on-chain." },
  { n: "07", name: "Reconcile", desc: "A workflow is complete only after canonical position reconciliation." },
  {
    n: "08",
    name: "Receipt / recovery",
    desc: "Durable workflow history with recovery actions if anything stalls.",
  },
];
