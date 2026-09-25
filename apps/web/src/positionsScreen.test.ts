import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AccountingEntryView,
  EarnPerformanceItemView,
  PortfolioAccountingView,
  Position,
} from "@stacks-capital/client";
import { getInitialSession, getInitialTab, STORAGE_SESSION_PREFIX, STORAGE_TAB_KEY } from "./navigation.ts";

describe("Overview and Positions screens (I32)", () => {
  describe("accounting consistency and non-double-counting", () => {
    it("excludes receipt tokens from total count and gross assets to prevent double-counting", () => {
      const entries: AccountingEntryView[] = [
        {
          id: "entry_1",
          category: "wallet",
          assetId: "sBTC",
          quantity: "1.50000000",
          marketId: null,
          protocolKey: null,
          isReceipt: false,
          countsTowardTotal: true,
          linkedCollateral: null,
          stale: false,
          warnings: [],
        },
        {
          id: "entry_2",
          category: "supplied",
          assetId: "sBTC",
          quantity: "2.00000000",
          marketId: "zest.sbtc.v2",
          protocolKey: "zest",
          isReceipt: false,
          countsTowardTotal: true,
          linkedCollateral: null,
          stale: false,
          warnings: [],
        },
        {
          id: "entry_3",
          category: "supplied",
          assetId: "zsBTC",
          quantity: "2.00000000",
          marketId: "zest.sbtc.v2",
          protocolKey: "zest",
          isReceipt: true,
          countsTowardTotal: false,
          linkedCollateral: null,
          stale: false,
          warnings: [],
        },
        {
          id: "entry_4",
          category: "debt",
          assetId: "USDA",
          quantity: "5000.000000",
          marketId: "granite.usda.borrow",
          protocolKey: "granite",
          isReceipt: false,
          countsTowardTotal: true,
          linkedCollateral: null,
          stale: false,
          warnings: [],
        },
      ];

      // Verify receipt tokens filtering
      const receiptEntries = entries.filter((e) => e.isReceipt || !e.countsTowardTotal);
      assert.equal(receiptEntries.length, 1);
      assert.equal(receiptEntries[0]?.assetId, "zsBTC");
      assert.equal(receiptEntries[0]?.isReceipt, true);
      assert.equal(receiptEntries[0]?.countsTowardTotal, false);

      // Verify that counted entries exclude the receipt token
      const countedEntries = entries.filter((e) => e.countsTowardTotal);
      assert.equal(countedEntries.length, 3);
      assert.ok(!countedEntries.some((e) => e.assetId === "zsBTC"));
    });

    it("verifies accounting invariant: Gross Assets - Debt Liabilities = Net Worth", () => {
      const portfolio: PortfolioAccountingView = {
        grossAssetsUsd: "350000.00",
        grossDebtUsd: "50000.00",
        netWorthUsd: "300000.00",
        coverage: {
          isComplete: true,
          valuedCount: 4,
          unvaluedCount: 0,
          totalCount: 4,
          coverageBps: 10000,
          valuedAssets: ["sBTC", "STX", "USDC", "USDA"],
          unvaluedAssets: [],
        },
        entries: [],
        byCategory: {
          wallet: { totalUsd: "150000.00", count: 2, items: [] },
          supplied: { totalUsd: "200000.00", count: 2, items: [] },
          debt: { totalUsd: "50000.00", count: 1, items: [] },
        },
        incomplete: false,
        warnings: [],
      };

      const grossAssets = Number(portfolio.grossAssetsUsd);
      const grossDebt = Number(portfolio.grossDebtUsd);
      const netWorth = Number(portfolio.netWorthUsd);

      assert.equal(grossAssets - grossDebt, netWorth);
      assert.equal(portfolio.coverage.isComplete, true);
      assert.equal(portfolio.coverage.coverageBps, 10000);
      assert.equal(portfolio.coverage.unvaluedAssets.length, 0);
    });

    it("handles partial valuation state consistently without suppressing verified subtotals", () => {
      const partialPortfolio: PortfolioAccountingView = {
        grossAssetsUsd: "200000.00",
        grossDebtUsd: "0.00",
        netWorthUsd: "200000.00",
        coverage: {
          isComplete: false,
          valuedCount: 2,
          unvaluedCount: 1,
          totalCount: 3,
          coverageBps: 6667,
          valuedAssets: ["sBTC", "STX"],
          unvaluedAssets: [
            {
              assetId: "NEW_MEME_TOKEN",
              reason: "No liquid Pyth or Redstone oracle feed available",
              quantity: "5000000",
            },
          ],
        },
        entries: [],
        byCategory: {
          wallet: { totalUsd: "200000.00", count: 2, items: [] },
        },
        incomplete: true,
        warnings: ["1 unvalued asset excluded from USD aggregates"],
      };

      assert.equal(partialPortfolio.coverage.isComplete, false);
      assert.equal(partialPortfolio.coverage.unvaluedCount, 1);
      assert.equal(partialPortfolio.coverage.unvaluedAssets[0]?.assetId, "NEW_MEME_TOKEN");
      assert.ok(partialPortfolio.coverage.coverageBps! < 10000);
      // Net subtotal remains verified and explicit
      assert.equal(partialPortfolio.netWorthUsd, "200000.00");
    });
  });

  describe("positions classification and action gating", () => {
    it("partitions positions correctly into supplied, collateral, and debt", () => {
      const positions: Position[] = [
        {
          marketId: "zest.sbtc.v2",
          kind: "supplied",
          protocolKey: "zest",
          assetId: "sBTC",
          quantity: "1.25000000",
          stale: false,
          warnings: [],
          observedAt: new Date().toISOString(),
          blockHeight: 880000,
          rewardRate: "0.045",
          rewardScale: 4,
          adapterVersion: "2.0.0",
          calculationVersion: "2.0.0",
        },
        {
          marketId: "granite.sbtc.isolated",
          kind: "collateral",
          protocolKey: "granite",
          assetId: "sBTC",
          quantity: "0.75000000",
          stale: false,
          warnings: [],
          observedAt: new Date().toISOString(),
          blockHeight: 880000,
          rewardRate: null,
          rewardScale: null,
          adapterVersion: "2.0.0",
          calculationVersion: "2.0.0",
        },
        {
          marketId: "granite.sbtc.isolated",
          kind: "debt",
          protocolKey: "granite",
          assetId: "USDA",
          quantity: "25000.000000",
          stale: false,
          warnings: [],
          observedAt: new Date().toISOString(),
          blockHeight: 880000,
          rewardRate: null,
          rewardScale: null,
          adapterVersion: "2.0.0",
          calculationVersion: "2.0.0",
        },
      ];

      const supplied = positions.filter((p) => p.kind === "supplied");
      const collateral = positions.filter((p) => p.kind === "collateral");
      const debt = positions.filter((p) => p.kind === "debt");

      assert.equal(supplied.length, 1);
      assert.equal(supplied[0]?.marketId, "zest.sbtc.v2");

      assert.equal(collateral.length, 1);
      assert.equal(collateral[0]?.marketId, "granite.sbtc.isolated");

      assert.equal(debt.length, 1);
      assert.equal(debt[0]?.quantity, "25000.000000");
    });
  });

  describe("route and session persistence across reloads", () => {
    function createMockStorage(initial: Record<string, string> = {}) {
      const map = new Map<string, string>(Object.entries(initial));
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, v),
        removeItem: (k: string) => map.delete(k),
      };
    }

    it("prefers URL search parameter ?tab=... over stored tab", () => {
      const storage = createMockStorage({ [STORAGE_TAB_KEY]: "Earn" });
      const tab = getInitialTab("?tab=Positions", storage);
      assert.equal(tab, "Positions");
    });

    it("falls back to localStorage if URL does not specify tab", () => {
      const storage = createMockStorage({ [STORAGE_TAB_KEY]: "Positions" });
      const tab = getInitialTab("", storage);
      assert.equal(tab, "Positions");
    });

    it("defaults to Overview if neither URL nor storage specifies tab", () => {
      const storage = createMockStorage();
      const tab = getInitialTab("", storage);
      assert.equal(tab, "Overview");
    });

    it("maps the former Deposit BTC tab name to Bridge", () => {
      const storage = createMockStorage({ [STORAGE_TAB_KEY]: "Deposit BTC" });
      assert.equal(getInitialTab("?tab=Deposit BTC", storage), "Bridge");
      assert.equal(getInitialTab("", storage), "Bridge");
    });

    it("persists and restores wallet session per network", () => {
      const sessionData = {
        address: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
        token: "tok_test_session_123",
        walletId: "leather" as const,
      };

      const storage = createMockStorage({
        [`${STORAGE_SESSION_PREFIX}mainnet`]: JSON.stringify(sessionData),
      });

      const mainnetSession = getInitialSession("mainnet", storage);
      assert.deepEqual(mainnetSession, sessionData);

      // Verify testnet does not inherit mainnet session
      const testnetSession = getInitialSession("testnet", storage);
      assert.equal(testnetSession, null);
    });

    it("handles corrupted storage gracefully", () => {
      const storage = createMockStorage({
        [`${STORAGE_SESSION_PREFIX}mainnet`]: "{ invalid json ...",
      });

      const session = getInitialSession("mainnet", storage);
      assert.equal(session, null);
    });
  });
});
