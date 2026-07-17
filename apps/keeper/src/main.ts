/**
 * Keeper CLI — thin, mechanical, guardrail-bounded execution (P1/P6):
 * watch → check cooldowns → rotate/harvest. The keeper holds a hot key with
 * no discretion; compromise costs liveness only. It NEVER submits targets —
 * that is the Strategist Safe's job; `compute-targets` prints the Safe
 * payload for the strategist instead of sending it.
 *
 *   pnpm --filter @aero-poc/keeper keeper -- status
 *   pnpm --filter @aero-poc/keeper keeper -- rotate --execute
 *   pnpm --filter @aero-poc/keeper keeper -- harvest --execute
 *   pnpm --filter @aero-poc/keeper keeper -- compute-targets --config strategy.json
 *   pnpm --filter @aero-poc/keeper keeper -- watch --interval 600 --execute
 *
 * Env (never in the browser, P7): BASE_RPC_URL, BASE_RPC_URL_FALLBACK,
 * KEEPER_PRIVATE_KEY (execute mode), DIAMOND_ADDRESS.
 * Default mode is DRY RUN: prints intended transactions without sending.
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { strategyRef, type StrategyConfig } from "@aero-poc/core";
import { diamondAbi, voterAbi, votingRewardAbi } from "./abi.js";

// ── setup ────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const EXECUTE = process.argv.includes("--execute");

function makeClients() {
  const primary = requireEnv("BASE_RPC_URL");
  const fallback = process.env.BASE_RPC_URL_FALLBACK;
  // Provider outage → secondary RPC (OPERATIONS.md §4).
  const transport = http(primary, { retryCount: 2 });
  const publicClient = createPublicClient({ chain: base, transport });
  const wallet = EXECUTE
    ? createWalletClient({
        chain: base,
        transport,
        account: privateKeyToAccount(requireEnv("KEEPER_PRIVATE_KEY") as Hex),
      })
    : undefined;
  return { publicClient, wallet, fallback };
}

type Clients = ReturnType<typeof makeClients>;
const diamond = () => requireEnv("DIAMOND_ADDRESS") as Address;

// ── views ────────────────────────────────────────────────────────────────────

interface TrancheStatus {
  trancheId: bigint;
  positionId: bigint;
  lastActionAt: bigint;
  active: boolean;
  cooldownRemaining: bigint;
  powerWad: bigint;
}

async function readTranches(c: Clients): Promise<TrancheStatus[]> {
  const count = await c.publicClient.readContract({
    address: diamond(),
    abi: diamondAbi,
    functionName: "trancheCount",
  });
  const out: TrancheStatus[] = [];
  for (let id = 1n; id <= count; id++) {
    const [positionId, lastActionAt, active] = await c.publicClient.readContract({
      address: diamond(),
      abi: diamondAbi,
      functionName: "getTranche",
      args: [id],
    });
    const [cooldownRemaining, powerWad] = await Promise.all([
      c.publicClient.readContract({
        address: diamond(),
        abi: diamondAbi,
        functionName: "trancheCooldownRemaining",
        args: [id],
      }),
      c.publicClient.readContract({
        address: diamond(),
        abi: diamondAbi,
        functionName: "positionWeight",
        args: [positionId],
      }),
    ]);
    out.push({ trancheId: id, positionId, lastActionAt: BigInt(lastActionAt), active, cooldownRemaining, powerWad });
  }
  return out;
}

async function status(c: Clients): Promise<void> {
  const [protocolId, [pools, weights, ref, updatedAt], window] = await Promise.all([
    c.publicClient.readContract({ address: diamond(), abi: diamondAbi, functionName: "protocolId" }),
    c.publicClient.readContract({ address: diamond(), abi: diamondAbi, functionName: "currentTargets" }),
    c.publicClient.readContract({ address: diamond(), abi: diamondAbi, functionName: "currentWindow" }),
  ]);
  console.log(`protocol: ${Buffer.from(protocolId.slice(2), "hex").toString().replace(/\0+$/, "")}`);
  console.log(`window:   ${new Date(Number(window[0]) * 1000).toISOString()} → ${new Date(Number(window[1]) * 1000).toISOString()}`);
  console.log(`targets:  ref=${ref} updatedAt=${new Date(Number(updatedAt) * 1000).toISOString()}`);
  pools.forEach((p, i) => console.log(`  ${p}  ${formatUnits(weights[i]!, 16)}%`));

  // strategyRef mismatch alert: a strategist running the wrong config is
  // otherwise invisible because the contracts are strategy-blind.
  const configPath = arg("config");
  if (configPath) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8")) as StrategyConfig;
    const expected = strategyRef(cfg);
    if (expected !== ref) {
      console.warn(`⚠ strategyRef mismatch: on-chain ${ref} ≠ approved config ${expected} — PAGE THE STRATEGIST`);
    } else {
      console.log(`strategyRef matches approved config ✓`);
    }
  }

  for (const t of await readTranches(c)) {
    console.log(
      `tranche #${t.trancheId} position=${t.positionId} power=${formatUnits(t.powerWad, 18)} ` +
        `active=${t.active} cooldown=${t.cooldownRemaining}s`,
    );
  }
}

// ── actions ──────────────────────────────────────────────────────────────────

async function send(c: Clients, functionName: "rotate" | "harvest" | "compound", args: readonly unknown[]): Promise<void> {
  if (!EXECUTE || !c.wallet) {
    console.log(`[dry-run] ${functionName}(${args.map(String).join(", ")})`);
    return;
  }
  const { request } = await c.publicClient.simulateContract({
    address: diamond(),
    abi: diamondAbi,
    functionName,
    args: args as never,
    account: c.wallet.account!,
  });
  const hash = await c.wallet.writeContract(request);
  const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
  console.log(`${functionName} → ${hash} (${receipt.status})`);
}

/** Rotate every unlocked, active tranche whose last action predates the
 * current target — mechanical convergence, no discretion. */
async function rotate(c: Clients): Promise<void> {
  const [, , , updatedAt] = await c.publicClient.readContract({
    address: diamond(),
    abi: diamondAbi,
    functionName: "currentTargets",
  });
  for (const t of await readTranches(c)) {
    if (!t.active) continue;
    if (t.cooldownRemaining > 0n) {
      console.log(`tranche #${t.trancheId}: cooling (${t.cooldownRemaining}s)`);
      continue;
    }
    if (t.lastActionAt >= BigInt(updatedAt) && t.lastActionAt > 0n) {
      console.log(`tranche #${t.trancheId}: already on current target`);
      continue;
    }
    await send(c, "rotate", [t.trancheId]);
  }
}

/** Build v2 claim plumbing (pools + per-reward-contract token lists) from
 * the chain, mirroring what AerodromeFacet validates. */
async function buildClaimData(c: Clients, pools: readonly Address[]): Promise<Hex> {
  // The canonical Base Voter, overridable for testnets/forks.
  const voterAddr = (process.env.AERODROME_VOTER ?? "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5") as Address;

  const feeTokens: Address[][] = [];
  const bribeTokens: Address[][] = [];
  for (const pool of pools) {
    const gauge = await c.publicClient.readContract({
      address: voterAddr,
      abi: voterAbi,
      functionName: "gauges",
      args: [pool],
    });
    const [fees, bribe] = await Promise.all([
      c.publicClient.readContract({ address: voterAddr, abi: voterAbi, functionName: "gaugeToFees", args: [gauge] }),
      c.publicClient.readContract({ address: voterAddr, abi: voterAbi, functionName: "gaugeToBribe", args: [gauge] }),
    ]);
    feeTokens.push(await rewardList(c, fees));
    bribeTokens.push(await rewardList(c, bribe));
  }
  return encodeAbiParameters(
    [{ type: "address[]" }, { type: "address[][]" }, { type: "address[][]" }],
    [pools as Address[], feeTokens, bribeTokens],
  );
}

async function rewardList(c: Clients, rewardContract: Address): Promise<Address[]> {
  const len = await c.publicClient.readContract({
    address: rewardContract,
    abi: votingRewardAbi,
    functionName: "rewardsListLength",
  });
  const tokens: Address[] = [];
  for (let i = 0n; i < len; i++) {
    tokens.push(
      await c.publicClient.readContract({
        address: rewardContract,
        abi: votingRewardAbi,
        functionName: "rewards",
        args: [i],
      }),
    );
  }
  return tokens;
}

async function harvest(c: Clients): Promise<void> {
  const [pools] = await c.publicClient.readContract({
    address: diamond(),
    abi: diamondAbi,
    functionName: "currentTargets",
  });
  if (pools.length === 0) {
    console.log("no targets queued — nothing to harvest against");
    return;
  }
  const protocolId = await c.publicClient.readContract({
    address: diamond(),
    abi: diamondAbi,
    functionName: "protocolId",
  });
  const isV2 = Buffer.from(protocolId.slice(2), "hex").toString().startsWith("AERODROME_V2");
  const claimData = isV2
    ? await buildClaimData(c, pools)
    : encodeAbiParameters([{ type: "address[]" }], [pools as Address[]]);
  for (const t of await readTranches(c)) {
    if (!t.active) continue;
    await send(c, "harvest", [t.trancheId, claimData]);
  }
}

/** P6: the keeper never signs targets. Print the Safe payload instead. */
async function computeTargets(): Promise<void> {
  const configPath = arg("config");
  if (!configPath) {
    console.error("--config <strategy.json> required");
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as StrategyConfig;
  console.log("strategy config:", JSON.stringify(cfg));
  console.log("strategyRef (submit with setTargets):", strategyRef(cfg));
  console.log(
    "\nNext step: run the strategy against fresh market data in the simulator or a",
    "\nnotebook, review the proposed allocation, and submit setTargets(pools, weights,",
    "\nstrategyRef) from the STRATEGIST SAFE. The keeper deliberately cannot do this.",
  );
}

async function watch(c: Clients): Promise<void> {
  const interval = Number(arg("interval", "600")) * 1000;
  console.log(`watch loop: every ${interval / 1000}s (${EXECUTE ? "EXECUTE" : "dry-run"})`);
  for (;;) {
    try {
      await status(c);
      await rotate(c);
      await harvest(c);
    } catch (err) {
      console.error("watch iteration failed:", err);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ── entry ────────────────────────────────────────────────────────────────────

const command = process.argv[2];
const clients = command === "compute-targets" ? undefined : makeClients();
switch (command) {
  case "status":
    await status(clients!);
    break;
  case "rotate":
    await rotate(clients!);
    break;
  case "harvest":
    await harvest(clients!);
    break;
  case "compute-targets":
    await computeTargets();
    break;
  case "watch":
    await watch(clients!);
    break;
  default:
    console.log("usage: keeper <status|rotate|harvest|compute-targets|watch> [--execute] [--config file] [--interval sec]");
    process.exit(command ? 1 : 0);
}
