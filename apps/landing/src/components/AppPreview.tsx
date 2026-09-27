import { useState } from "react";
import {
  APP_TABS,
  BTC_PRICE,
  COLLATERAL_USD,
  EARN_ALLOCATION,
  HEALTH_BANDS,
  HISTORY_BARS,
  NET_VALUE,
  POSITIONS,
  SWAP_RATE,
  WALLET_CHIP,
} from "../data/appPreview.ts";
import { useCountdown } from "../hooks/useCountdown.ts";
import { SectionHeading } from "./SectionHeading.tsx";

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function AppPreview() {
  const [tab, setTab] = useState(0);
  const active = APP_TABS[tab];

  return (
    <section className="shell">
      <SectionHeading
        eyebrow="Inside the app"
        eyebrowColor="var(--color-purple)"
        width={620}
        title="One dashboard for every position."
      />

      <div className="rounded-[28px] bg-ink p-3 shadow-[0_40px_80px_rgba(23,23,29,0.18)]">
        <div className="flex flex-wrap items-center justify-between gap-4 px-2.5 pt-2 pb-3.5">
          <div className="flex flex-wrap gap-1 rounded-full bg-paper/6 p-1" role="tablist">
            {APP_TABS.map((item, index) => (
              <button
                key={item.name}
                type="button"
                role="tab"
                aria-selected={index === tab}
                onClick={() => setTab(index)}
                className={`cursor-pointer rounded-full px-[18px] py-[9px] text-sm font-bold transition-all ${
                  index === tab ? "bg-paper text-ink" : "bg-transparent text-paper/70"
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-full bg-paper/6 px-3.5 py-2 font-mono text-[13px] font-bold text-paper/80">
            <span className="size-2 rounded-full bg-green" />
            {WALLET_CHIP}
          </div>
        </div>

        <div className="min-h-[420px] rounded-[18px] bg-paper p-[clamp(20px,3vw,36px)]">
          {tab === 0 ? <OverviewTab /> : null}
          {tab === 1 ? <EarnTab /> : null}
          {tab === 2 ? <BorrowTab /> : null}
          {tab === 3 ? <SwapTab /> : null}
        </div>
      </div>

      {active ? (
        <div className="mt-5 flex items-baseline gap-3 px-2">
          <span className="text-[15px] font-extrabold">{active.name}</span>
          <span className="text-[14.5px] leading-relaxed text-ink/60">{active.desc}</span>
        </div>
      ) : null}
    </section>
  );
}

function OverviewTab() {
  const [hovered, setHovered] = useState(HISTORY_BARS.length - 1);
  const peak = HISTORY_BARS[HISTORY_BARS.length - 1]?.height ?? 1;
  const height = HISTORY_BARS[hovered]?.height ?? peak;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-8">
      <div>
        <div className="mb-1.5 text-[13px] font-bold text-ink/50">Verified net value</div>
        <div className="mb-2.5 text-[clamp(40px,5vw,56px)] font-extrabold tracking-[-0.02em]">{usd(NET_VALUE)}</div>
        <span className="mb-6 inline-block rounded-full bg-green/14 px-3 py-[5px] text-[12.5px] font-extrabold text-green-dark">
          Risk status: Healthy
        </span>

        <div className="flex h-[110px] items-end gap-1">
          {HISTORY_BARS.map((bar, index) => (
            <button
              key={bar.id}
              type="button"
              aria-label={`Observation ${index + 1}`}
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              className="flex-1 cursor-pointer rounded-t-md transition-colors"
              style={{
                height: `${bar.height}%`,
                background: index === hovered ? "var(--color-purple)" : "rgba(108,85,217,0.22)",
              }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex justify-between text-[12.5px] text-ink/50">
          <span>Canonical observations only</span>
          <span className="font-extrabold text-ink">{usd((NET_VALUE * height) / peak)}</span>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[13px] font-bold text-ink/50">Positions</div>
        {POSITIONS.map((position) => (
          <div key={position.name} className="flex items-center justify-between border-t border-ink/8 py-3.5">
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full" style={{ background: position.color }} />
              <div>
                <div className="text-[15px] font-extrabold">{position.name}</div>
                <div className="text-[12.5px] text-ink/50">{position.sub}</div>
              </div>
            </div>
            <div className="text-[15px] font-extrabold">{position.value}</div>
          </div>
        ))}
        <div className="mt-3 rounded-xl bg-cream px-4 py-3.5 text-[13.5px]">
          <strong>Next action:</strong> 0.15 sBTC is idle and could be put to work.
        </div>
      </div>
    </div>
  );
}

function EarnTab() {
  const [amount, setAmount] = useState(1);
  const projection = EARN_ALLOCATION.reduce(
    (total, row) => total + (amount * row.weight * BTC_PRICE * row.apy * 90) / 365,
    0,
  );

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-8">
      <div>
        <label htmlFor="earn-amount" className="mb-1.5 block text-[13px] font-bold text-ink/50">
          How much do you want to put to work?
        </label>
        <div className="mb-[18px] text-[clamp(40px,5vw,56px)] font-extrabold tracking-[-0.02em]">
          {amount.toFixed(2)} <span className="text-[22px] text-ink/45">sBTC</span>
        </div>
        <input
          id="earn-amount"
          type="range"
          min="0.05"
          max="2"
          step="0.05"
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
          className="accent-orange"
        />
        <div className="mt-1.5 flex justify-between text-xs text-ink/45">
          <span>0.05</span>
          <span>2.00</span>
        </div>

        <div className="mt-7 flex flex-wrap gap-6">
          <div>
            <div className="text-[12.5px] font-bold text-ink/50">Projected 90-day earnings</div>
            <div className="text-[26px] font-extrabold">{usd(projection)}</div>
          </div>
          <div>
            <div className="text-[12.5px] font-bold text-ink/50">Evidence confidence</div>
            <div className="text-[26px] font-extrabold">91%</div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[13px] font-bold text-ink/50">Suggested allocation</div>
        {EARN_ALLOCATION.map((row) => (
          <div key={row.name} className="border-t border-ink/8 py-3">
            <div className="mb-2 flex justify-between text-[14.5px]">
              <span className="font-extrabold">
                {row.name} <span className="font-semibold text-ink/50">· {row.rate}</span>
              </span>
              <span className="font-extrabold">{(amount * row.weight).toFixed(3)} sBTC</span>
            </div>
            <div className="h-1.5 rounded-full bg-ink/7">
              <div className="h-1.5 rounded-full" style={{ width: `${row.weight * 100}%`, background: row.color }} />
            </div>
          </div>
        ))}
        <p className="mt-3 text-[12.5px] text-ink/50">Projections are informational and not guaranteed.</p>
      </div>
    </div>
  );
}

function BorrowTab() {
  const [borrowed, setBorrowed] = useState(833);
  const health = COLLATERAL_USD / borrowed;
  const band = HEALTH_BANDS.find((item) => health >= item.floor) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1];
  const knob = Math.max(2, Math.min(98, ((health - 1) / 1.5) * 100));

  if (!band) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-8">
      <div>
        <label htmlFor="borrow-amount" className="mb-1.5 block text-[13px] font-bold text-ink/50">
          Borrow against 0.028 sBTC collateral
        </label>
        <div className="mb-[18px] text-[clamp(40px,5vw,56px)] font-extrabold tracking-[-0.02em]">{usd(borrowed)}</div>
        <input
          id="borrow-amount"
          type="range"
          min="50"
          max="1200"
          step="10"
          value={borrowed}
          onChange={(event) => setBorrowed(Number(event.target.value))}
          className="accent-purple"
        />
        <div className="mt-1.5 flex justify-between text-xs text-ink/45">
          <span>$50</span>
          <span>$1,200</span>
        </div>
      </div>

      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="text-[13px] font-bold text-ink/50">Health factor</span>
          <span className="text-[30px] font-extrabold" style={{ color: band.color }}>
            {health.toFixed(2)}
          </span>
        </div>
        <div
          className="relative mb-[22px] h-2.5 rounded-full"
          style={{
            background: "linear-gradient(90deg, var(--color-red) 0%, var(--color-yellow) 35%, var(--color-green) 70%)",
          }}
        >
          <div
            className="absolute -top-[5px] size-5 -translate-x-1/2 rounded-full border-[3px] border-ink bg-paper transition-[left] duration-150"
            style={{ left: `${knob}%` }}
          />
        </div>
        <div className="rounded-2xl px-[18px] py-4" style={{ background: band.bg }}>
          <div className="mb-1 text-[15px] font-extrabold" style={{ color: band.color }}>
            {band.title}
          </div>
          <div className="text-sm leading-[1.5] text-ink/70">{band.text}</div>
        </div>
      </div>
    </div>
  );
}

function SwapTab() {
  const [pay, setPay] = useState("0.10");
  const seconds = useCountdown(30);
  const received = (Number.parseFloat(pay) || 0) * SWAP_RATE;
  const decimals = { maximumFractionDigits: 2 };

  return (
    <div className="mx-auto max-w-[520px]">
      <div className="mb-1.5 rounded-2xl bg-canvas px-5 py-[18px]">
        <label htmlFor="swap-pay" className="mb-1.5 block text-[12.5px] font-bold text-ink/50">
          You pay
        </label>
        <div className="flex items-center justify-between gap-3">
          <input
            id="swap-pay"
            type="number"
            min="0"
            step="0.01"
            value={pay}
            onChange={(event) => setPay(event.target.value)}
            className="w-full border-none bg-transparent text-[34px] font-extrabold text-ink outline-none"
          />
          <span className="rounded-full bg-paper px-3.5 py-2 text-sm font-extrabold">sBTC</span>
        </div>
      </div>

      <div className="rounded-2xl bg-canvas px-5 py-[18px]">
        <div className="mb-1.5 text-[12.5px] font-bold text-ink/50">You receive (estimated)</div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-[34px] font-extrabold">{received.toLocaleString("en-US", decimals)}</div>
          <span className="rounded-full bg-paper px-3.5 py-2 text-sm font-extrabold">STX</span>
        </div>
      </div>

      <dl className="m-0 px-1 pt-4">
        {[
          { k: "Minimum received (enforced)", v: `${(received * 0.995).toLocaleString("en-US", decimals)} STX` },
          { k: "Route", v: "Bitflow · verified pool" },
        ].map((row) => (
          <div key={row.k} className="flex justify-between py-1.5 text-[13.5px]">
            <dt className="text-ink/55">{row.k}</dt>
            <dd className="m-0 font-extrabold">{row.v}</dd>
          </div>
        ))}
        <div className="flex justify-between py-1.5 text-[13.5px]">
          <dt className="text-ink/55">Quote expires in</dt>
          <dd
            className="m-0 font-extrabold"
            style={{ color: seconds <= 10 ? "var(--color-red-text)" : "var(--color-ink)" }}
          >
            {seconds}s
          </dd>
        </div>
      </dl>

      <button
        type="button"
        className="mt-4 w-full cursor-pointer rounded-full bg-orange p-4 text-base font-extrabold text-ink transition-colors hover:bg-orange-hover"
      >
        Review swap
      </button>
    </div>
  );
}
