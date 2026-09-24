import { createStacksCapital } from "@stacks-capital/sdk";
import { startDemoCapitalApi } from "./demo-server.ts";
import { FALLBACK_SANDBOX_OWNER, getDisposableMnemonic } from "./disposable-test-account.ts";
import { ownerFromMnemonic, signUnsignedPlan } from "./host-sign.ts";
import {
  PARTNER_SWAP_AMOUNT,
  PARTNER_SWAP_INPUT,
  PARTNER_SWAP_OUTPUT,
  runSwapCompare,
  runZestSupply,
  runZestWithdrawSupply,
  stakingIsDisabled,
} from "./program.ts";
import { readPartnerServerEnv } from "./server-env.ts";

const live = process.argv.includes("--live");
const { apiUrl: apiBase, apiKey } = readPartnerServerEnv();
let mnemonic = "";
try {
  mnemonic = getDisposableMnemonic(process.env.CAPITAL_MNEMONIC);
} catch {
  mnemonic = "";
}
const canSign = mnemonic.trim().split(/\s+/).length >= 12;
const owner =
  process.env.CAPITAL_OWNER ?? (canSign ? ownerFromMnemonic(mnemonic, "mainnet").address : FALLBACK_SANDBOX_OWNER);

const demo = apiBase === undefined || apiBase === "" ? await startDemoCapitalApi({ live }) : null;

try {
  console.log("Stacks Capital partner example");
  console.log(`  mode: ${live ? "live Hiro/Emily/DIA" : "fixtures"}`);
  console.log(`  api: ${demo?.url ?? apiBase}`);
  console.log(`  owner: ${owner}`);

  // --- Step 1: Entry (supply sBTC to earn vault) ---
  const supplyResult = await runZestSupply({
    apiBase: demo?.url ?? apiBase ?? "",
    network: "mainnet",
    owner,
    ...(apiKey === undefined ? {} : { apiKey }),
  });
  console.log("\n[Entry: Zest Supply]");
  console.log(`  quote: ${supplyResult.quote.id} executable=${String(supplyResult.quote.executable)}`);
  console.log(`  receipt: ${supplyResult.outputQuantity} ${supplyResult.outputAsset}`);
  console.log(`  plan: ${supplyResult.plan.id}`);
  console.log(`  review: ${supplyResult.plan.reviewSummary}`);
  console.log(`  sdk validate: ok`);
  console.log(`  workflow: ${supplyResult.workflowState}`);

  if (canSign) {
    const signedSupply = await signUnsignedPlan(supplyResult.plan, mnemonic, "mainnet");
    const outcome = createStacksCapital({ network: "mainnet" }).inspectWalletResult(signedSupply);
    console.log(
      `  host sign: ${outcome} ${signedSupply.functionName} ${signedSupply.contractId} (${String(signedSupply.transaction.length)} hex chars, not broadcast)`,
    );
  } else {
    console.log("  host sign: skipped (set CAPITAL_MNEMONIC to sign locally without broadcasting)");
  }

  // --- Step 2: Exit (withdraw_supply / redeem zsBTC from earn vault) ---
  const exitResult = await runZestWithdrawSupply({
    apiBase: demo?.url ?? apiBase ?? "",
    network: "mainnet",
    owner,
    ...(apiKey === undefined ? {} : { apiKey }),
  });
  console.log("\n[Exit: Zest Withdraw Supply]");
  console.log(`  quote: ${exitResult.quote.id} executable=${String(exitResult.quote.executable)}`);
  console.log(`  redemption output: ${exitResult.outputQuantity} ${exitResult.outputAsset}`);
  console.log(`  plan: ${exitResult.plan.id}`);
  console.log(`  review: ${exitResult.plan.reviewSummary}`);
  console.log(`  sdk validate: ok`);
  console.log(`  workflow: ${exitResult.workflowState}`);

  if (canSign) {
    const signedExit = await signUnsignedPlan(exitResult.plan, mnemonic, "mainnet");
    const outcome = createStacksCapital({ network: "mainnet" }).inspectWalletResult(signedExit);
    console.log(
      `  host sign: ${outcome} ${signedExit.functionName} ${signedExit.contractId} (${String(signedExit.transaction.length)} hex chars, not broadcast)`,
    );
  } else {
    console.log("  host sign: skipped (set CAPITAL_MNEMONIC to sign locally without broadcasting)");
  }

  const swapResult = await runSwapCompare(
    {
      apiBase: demo?.url ?? apiBase ?? "",
      network: "mainnet",
      owner,
      ...(apiKey === undefined ? {} : { apiKey }),
    },
    {
      inputAsset: PARTNER_SWAP_INPUT,
      outputAsset: PARTNER_SWAP_OUTPUT,
      amount: PARTNER_SWAP_AMOUNT,
      slippageBps: 50,
    },
  );
  console.log("\n[Swap: compare Bitflow, Velar, ALEX]");
  console.log(`  catalog: ${String(swapResult.catalog.data.items.length)} tokens`);
  console.log(
    `  recommended: ${swapResult.recommended?.provider ?? "none"} min-out=${swapResult.recommended?.minimumAmountOut ?? "0"}`,
  );
  console.log(`  selected: ${swapResult.selected?.provider ?? "none"}`);
  console.log(
    `  unavailable: ${swapResult.comparison.data.unavailable.map((item) => item.provider).join(", ") || "none"}`,
  );
  const walletCall = swapResult.selected?.walletCall;
  console.log(`  walletCall: ${walletCall === undefined ? "none" : walletCall.functionName}`);

  console.log(`\n  staking enabled: ${String(!stakingIsDisabled())}`);
} finally {
  await demo?.close();
}
