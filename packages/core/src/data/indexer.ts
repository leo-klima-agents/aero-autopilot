/**
 * Aerodrome history indexer (plan §5 data/): pulls per-epoch, per-pool vote
 * weights, voter revenue (fees + incentives notified to the voting-reward
 * contracts), and gauge emissions for the top-N pools, emitting a raw
 * schema-versioned JSON that calibrate.ts reduces to an EpochDataset.
 *
 * Consumes RPC_URL/ALCHEMY_KEY from the environment only (P7) — run by
 * data.yml in CI or locally, never from the browser.
 */
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";
import { AERODROME, EPOCH_SECONDS, epochStart, voterAbi } from "./aerodrome.js";

export interface RawPoolMeta {
  pool: Address;
  gauge: Address;
  feesReward: Address;
  bribeReward: Address;
}

export interface RawRewardEvent {
  pool: Address;
  token: Address;
  amount: string;
}

export interface RawEpochRow {
  start: string;
  endBlock: string;
  /** Voter.weights(pool) sampled at the last block of the epoch. */
  votesWad: string[];
  rewards: RawRewardEvent[];
  /** AERO distributed to each pool's gauge during the epoch. */
  emissionsWad: string[];
}

export interface RawDataset {
  schemaVersion: 1;
  source: "aerodrome-base-mainnet";
  chainId: 8453;
  epochSec: string;
  indexedAt: string;
  pools: RawPoolMeta[];
  epochs: RawEpochRow[];
}

export function makeClient(rpcUrl: string) {
  return createPublicClient({ chain: base, transport: http(rpcUrl, { batch: true }) });
}

export type IndexerClient = ReturnType<typeof makeClient>;

/** Binary-search the last block with timestamp < ts. */
export async function blockBefore(client: IndexerClient, ts: bigint): Promise<bigint> {
  let hi = await client.getBlockNumber();
  let lo = 1n;
  const latest = await client.getBlock({ blockNumber: hi });
  if (latest.timestamp < ts) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const b = await client.getBlock({ blockNumber: mid });
    if (b.timestamp < ts) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/** Top-N live pools by current vote weight, with their reward contracts. */
export async function discoverTopPools(client: IndexerClient, n: number): Promise<RawPoolMeta[]> {
  const voter = { address: AERODROME.voter as Address, abi: voterAbi } as const;
  const length = await client.readContract({ ...voter, functionName: "length" });
  const count = Number(length);
  const idx = Array.from({ length: count }, (_, i) => BigInt(i));

  const pools = (await multicallChunked(client, idx.map((i) => ({ ...voter, functionName: "pools", args: [i] as const })))) as Address[];
  const weights = (await multicallChunked(client, pools.map((p) => ({ ...voter, functionName: "weights", args: [p] as const })))) as bigint[];

  const ranked = pools
    .map((pool, i) => ({ pool, weight: weights[i] ?? 0n }))
    .sort((a, b) => (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : 0))
    .slice(0, n);

  const gauges = (await multicallChunked(client, ranked.map((r) => ({ ...voter, functionName: "gauges", args: [r.pool] as const })))) as Address[];
  const fees = (await multicallChunked(client, gauges.map((g) => ({ ...voter, functionName: "gaugeToFees", args: [g] as const })))) as Address[];
  const bribes = (await multicallChunked(client, gauges.map((g) => ({ ...voter, functionName: "gaugeToBribe", args: [g] as const })))) as Address[];

  return ranked.map((r, i) => ({
    pool: r.pool,
    gauge: gauges[i]!,
    feesReward: fees[i]!,
    bribeReward: bribes[i]!,
  }));
}

async function multicallChunked(
  client: IndexerClient,
  contracts: readonly { address: Address; abi: typeof voterAbi; functionName: string; args?: readonly unknown[] }[],
  chunk = 300,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < contracts.length; i += chunk) {
    const res = await client.multicall({
      contracts: contracts.slice(i, i + chunk) as never,
      allowFailure: false,
    });
    out.push(...(res as unknown[]));
  }
  return out;
}

const notifyRewardEvent = parseAbiItem(
  "event NotifyReward(address indexed from, address indexed reward, uint256 indexed epoch, uint256 amount)",
);
const distributeRewardEvent = parseAbiItem(
  "event DistributeReward(address indexed sender, address indexed gauge, uint256 amount)",
);

async function getLogsChunked<TEvent extends typeof notifyRewardEvent | typeof distributeRewardEvent>(
  client: IndexerClient,
  addresses: Address[],
  event: TEvent,
  fromBlock: bigint,
  toBlock: bigint,
  span = 9_000n,
) {
  const out = [];
  for (let from = fromBlock; from <= toBlock; from += span + 1n) {
    const to = from + span > toBlock ? toBlock : from + span;
    out.push(...(await client.getLogs({ address: addresses, event, fromBlock: from, toBlock: to })));
  }
  return out;
}

export interface IndexOptions {
  rpcUrl: string;
  topPools: number;
  epochs: number;
  /**
   * eth_getLogs block-range chunk. Default 9000 requires a paid RPC tier
   * (Alchemy free tier caps the range at 10 blocks, which makes full-epoch
   * scans infeasible — data.yml must use a Growth/PAYG key).
   */
  logSpan?: bigint;
  /** Progress callback. */
  onProgress?: (msg: string) => void;
}

export async function indexAerodrome(opts: IndexOptions): Promise<RawDataset> {
  const client = makeClient(opts.rpcUrl);
  const log = opts.onProgress ?? (() => {});

  log(`discovering top ${opts.topPools} pools…`);
  const pools = await discoverTopPools(client, opts.topPools);
  const rewardToPool = new Map<string, Address>();
  for (const p of pools) {
    rewardToPool.set(p.feesReward.toLowerCase(), p.pool);
    rewardToPool.set(p.bribeReward.toLowerCase(), p.pool);
  }
  const gaugeToPoolIdx = new Map<string, number>();
  pools.forEach((p, i) => gaugeToPoolIdx.set(p.gauge.toLowerCase(), i));

  const latest = await client.getBlock();
  const currentEpoch = epochStart(latest.timestamp);

  const rows: RawEpochRow[] = [];
  for (let e = opts.epochs; e >= 1; e--) {
    const start = currentEpoch - BigInt(e) * EPOCH_SECONDS;
    const end = start + EPOCH_SECONDS;
    log(`epoch ${start} (${new Date(Number(start) * 1000).toISOString().slice(0, 10)})…`);
    const startBlock = (await blockBefore(client, start)) + 1n;
    const endBlock = await blockBefore(client, end);

    const votes = (await multicallChunked(
      client,
      pools.map((p) => ({
        address: AERODROME.voter as Address,
        abi: voterAbi,
        functionName: "weights",
        args: [p.pool] as const,
        blockNumber: endBlock,
      })),
    )) as bigint[];

    const span = opts.logSpan ?? 9_000n;
    const rewardAddrs = pools.flatMap((p) => [p.feesReward, p.bribeReward]);
    const notifyLogs =
      await getLogsChunked(client, rewardAddrs, notifyRewardEvent, startBlock, endBlock, span);
    const rewards: RawRewardEvent[] = notifyLogs.map((l) => ({
      pool: rewardToPool.get(l.address.toLowerCase())!,
      token: l.args.reward!,
      amount: (l.args.amount ?? 0n).toString(),
    }));

    const distLogs = await getLogsChunked(
      client,
      [AERODROME.voter as Address],
      distributeRewardEvent,
      startBlock,
      endBlock,
      span,
    );
    const emissions = pools.map(() => 0n);
    for (const l of distLogs) {
      const idx = gaugeToPoolIdx.get((l.args.gauge ?? "").toLowerCase());
      if (idx !== undefined) emissions[idx] = emissions[idx]! + (l.args.amount ?? 0n);
    }

    rows.push({
      start: start.toString(),
      endBlock: endBlock.toString(),
      votesWad: votes.map((v) => v.toString()),
      rewards,
      emissionsWad: emissions.map((x) => x.toString()),
    });
  }

  return {
    schemaVersion: 1,
    source: "aerodrome-base-mainnet",
    chainId: 8453,
    epochSec: EPOCH_SECONDS.toString(),
    indexedAt: new Date().toISOString(),
    pools,
    epochs: rows,
  };
}
