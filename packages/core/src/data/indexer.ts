/**
 * Aerodrome history indexer (plan §5 data/): pulls per-epoch, per-pool vote
 * weights, voter revenue (fees + incentives notified to the voting-reward
 * contracts), and gauge emissions for the top-N pools, emitting a raw
 * schema-versioned JSON that calibrate.ts reduces to an EpochDataset.
 *
 * Consumes BASE_RPC_URL from the environment only (P7) — run by data.yml in
 * CI or locally, never from the browser.
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

export interface ClientOptions {
  /** Per-request timeout, ms (default 30s — epoch-boundary getLogs can be slow). */
  timeoutMs?: number;
}

export function makeClient(rpcUrl: string, opts: ClientOptions = {}) {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl, {
      // No JSON-RPC array batching, ever: some providers/gateways hang on
      // array-wrapped requests, batch items count individually against rate
      // caps anyway, and bounded chunk concurrency (below) is the sanctioned
      // way to overlap latency.
      batch: false,
      timeout: opts.timeoutMs ?? 30_000,
      retryCount: 5,
      retryDelay: 500,
    }),
  });
}

export type IndexerClient = ReturnType<typeof makeClient>;

/**
 * Global request pacer: awaits long enough between request starts to stay
 * under a requests-per-second budget. Provider rate caps (e.g. QuickNode's
 * 50 rps entry tier) count every JSON-RPC call, and viem retries add bursts,
 * so the default budget stays well under typical caps.
 *
 * Concurrency-safe by construction: the read-modify-write of nextSlot is
 * synchronous, so N concurrent callers reserve N distinct, correctly spaced
 * start slots before any of them awaits.
 */
export class Pacer {
  private nextSlot = 0;
  constructor(private readonly rps: number) {}

  async tick(): Promise<void> {
    const interval = 1000 / this.rps;
    const now = Date.now();
    const wait = this.nextSlot - now;
    this.nextSlot = Math.max(now, this.nextSlot) + interval;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * Fail fast, loudly, and with a diagnosis BEFORE the long crawl starts: a
 * wrong secret, a non-Base endpoint, or a provider that can't serve the
 * indexer should die here, not 40 minutes in.
 */
export async function preflight(client: IndexerClient, log: (msg: string) => void): Promise<void> {
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (err) {
    throw new Error(
      "preflight: BASE_RPC_URL did not answer eth_chainId. Check that the secret is a plain " +
        "JSON-RPC URL with no trailing whitespace/newline, that the provider is up, and that it " +
        `accepts POST from CI. Underlying error: ${(err as Error).message?.split("\n")[0]}`,
    );
  }
  if (chainId !== base.id) {
    throw new Error(
      `preflight: BASE_RPC_URL is chain ${chainId}, expected Base (${base.id}) — wrong endpoint in the secret.`,
    );
  }
  const block = await client.getBlockNumber();
  log(`preflight ok: Base chainId ${chainId}, head block ${block}`);
}

/** Binary-search the last block with timestamp < ts. */
export async function blockBefore(client: IndexerClient, ts: bigint, pacer?: Pacer): Promise<bigint> {
  await pacer?.tick();
  let hi = await client.getBlockNumber();
  let lo = 1n;
  await pacer?.tick();
  const latest = await client.getBlock({ blockNumber: hi });
  if (latest.timestamp < ts) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    await pacer?.tick();
    const b = await client.getBlock({ blockNumber: mid });
    if (b.timestamp < ts) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/** Top-N live pools by current vote weight, with their reward contracts. */
export async function discoverTopPools(client: IndexerClient, n: number, pacer?: Pacer): Promise<RawPoolMeta[]> {
  const voter = { address: AERODROME.voter as Address, abi: voterAbi } as const;
  await pacer?.tick();
  const length = await client.readContract({ ...voter, functionName: "length" });
  const count = Number(length);
  const idx = Array.from({ length: count }, (_, i) => BigInt(i));

  const pools = (await multicallChunked(client, idx.map((i) => ({ ...voter, functionName: "pools", args: [i] as const })), pacer)) as Address[];
  const weights = (await multicallChunked(client, pools.map((p) => ({ ...voter, functionName: "weights", args: [p] as const })), pacer)) as bigint[];

  const ranked = pools
    .map((pool, i) => ({ pool, weight: weights[i] ?? 0n }))
    .sort((a, b) => (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : 0))
    .slice(0, n);

  const gauges = (await multicallChunked(client, ranked.map((r) => ({ ...voter, functionName: "gauges", args: [r.pool] as const })), pacer)) as Address[];
  const fees = (await multicallChunked(client, gauges.map((g) => ({ ...voter, functionName: "gaugeToFees", args: [g] as const })), pacer)) as Address[];
  const bribes = (await multicallChunked(client, gauges.map((g) => ({ ...voter, functionName: "gaugeToBribe", args: [g] as const })), pacer)) as Address[];

  return ranked.map((r, i) => ({
    pool: r.pool,
    gauge: gauges[i]!,
    feesReward: fees[i]!,
    bribeReward: bribes[i]!,
  }));
}

/**
 * One aggregate3 request per chunk, strictly sequential and paced. The large
 * batchSize is deliberate: viem's default (1,024 bytes of calldata) silently
 * splits a chunk into dozens of sub-batches fired CONCURRENTLY via
 * Promise.allSettled — a burst that blows per-second provider caps (observed:
 * QuickNode 50 rps during pool discovery). 300 simple reads ≈ 45 KB of
 * calldata, comfortably below eth_call limits.
 */
async function multicallChunked(
  client: IndexerClient,
  contracts: readonly { address: Address; abi: typeof voterAbi; functionName: string; args?: readonly unknown[] }[],
  pacer?: Pacer,
  chunk = 300,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < contracts.length; i += chunk) {
    await pacer?.tick();
    const res = await client.multicall({
      contracts: contracts.slice(i, i + chunk) as never,
      allowFailure: false,
      batchSize: 2 ** 20,
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

/**
 * Chunked log scan with bounded concurrency: up to `concurrency` independent
 * range queries in flight at once, every request start still reserved through
 * the shared Pacer, results flattened in deterministic chunk order (so the
 * committed dataset is byte-stable regardless of completion order).
 *
 * Concurrency is the sanctioned latency lever (JSON-RPC batching is not: it
 * coalesces only simultaneous requests, counts per-item against rate caps,
 * and some gateways hang on it). Wall time ≈ chunks × latency ÷ concurrency,
 * with the rps budget as the hard ceiling.
 *
 * @param span blocks per query (from..to inclusive), matching how providers
 * document their eth_getLogs range limits: span 10000 = a 10,000-block query.
 * Exported for tests.
 */
export async function getLogsChunked<
  TEvent extends typeof notifyRewardEvent | typeof distributeRewardEvent,
>(
  client: IndexerClient,
  addresses: Address[],
  event: TEvent,
  fromBlock: bigint,
  toBlock: bigint,
  span: bigint,
  pacer?: Pacer,
  concurrency = 1,
) {
  if (span < 1n) throw new Error("logSpan must be ≥ 1 block");
  if (concurrency < 1) throw new Error("concurrency must be ≥ 1");

  const chunks: { from: bigint; to: bigint }[] = [];
  for (let from = fromBlock; from <= toBlock; from += span) {
    const to = from + span - 1n > toBlock ? toBlock : from + span - 1n;
    chunks.push({ from, to });
  }

  type Log = Awaited<ReturnType<typeof client.getLogs<TEvent>>>[number];
  const results: Log[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= chunks.length) return;
      await pacer?.tick();
      results[i] = (await client.getLogs({
        address: addresses,
        event,
        fromBlock: chunks[i]!.from,
        toBlock: chunks[i]!.to,
      })) as Log[];
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length || 1) }, worker));
  return results.flat();
}

export interface IndexOptions {
  rpcUrl: string;
  topPools: number;
  epochs: number;
  /**
   * eth_getLogs chunk in BLOCKS PER QUERY, matching how providers document
   * their range limits. Default 10000 = the limit QuickNode documents for
   * paid plans. Requires a paid RPC tier either way (QuickNode free trial:
   * 5 blocks; Alchemy free: 10 — both make full-epoch scans infeasible).
   */
  logSpan?: bigint;
  /**
   * Requests-per-second budget across ALL JSON-RPC calls (default 15 —
   * conservative under common entry-tier caps like QuickNode's 50 rps,
   * leaving headroom for viem's automatic retries).
   */
  rps?: number;
  /**
   * Log-scan requests in flight at once (default 5). Overlaps round-trip
   * latency without touching the rps ceiling — the Pacer still spaces every
   * request start.
   */
  concurrency?: number;
  /** Transport tuning (see ClientOptions). */
  client?: ClientOptions;
  /** Progress callback. */
  onProgress?: (msg: string) => void;
}

export async function indexAerodrome(opts: IndexOptions): Promise<RawDataset> {
  const client = makeClient(opts.rpcUrl, opts.client ?? {});
  const log = opts.onProgress ?? (() => {});
  const pacer = new Pacer(opts.rps ?? 15);

  await preflight(client, log);
  log(`discovering top ${opts.topPools} pools…`);
  const pools = await discoverTopPools(client, opts.topPools, pacer);
  const rewardToPool = new Map<string, Address>();
  for (const p of pools) {
    rewardToPool.set(p.feesReward.toLowerCase(), p.pool);
    rewardToPool.set(p.bribeReward.toLowerCase(), p.pool);
  }
  const gaugeToPoolIdx = new Map<string, number>();
  pools.forEach((p, i) => gaugeToPoolIdx.set(p.gauge.toLowerCase(), i));

  await pacer.tick();
  const latest = await client.getBlock();
  const currentEpoch = epochStart(latest.timestamp);

  const rows: RawEpochRow[] = [];
  for (let e = opts.epochs; e >= 1; e--) {
    const start = currentEpoch - BigInt(e) * EPOCH_SECONDS;
    const end = start + EPOCH_SECONDS;
    log(`epoch ${start} (${new Date(Number(start) * 1000).toISOString().slice(0, 10)})…`);
    const startBlock = (await blockBefore(client, start, pacer)) + 1n;
    const endBlock = await blockBefore(client, end, pacer);

    const votes = (await multicallChunked(
      client,
      pools.map((p) => ({
        address: AERODROME.voter as Address,
        abi: voterAbi,
        functionName: "weights",
        args: [p.pool] as const,
        blockNumber: endBlock,
      })),
      pacer,
    )) as bigint[];

    const span = opts.logSpan ?? 10_000n;
    const rewardAddrs = pools.flatMap((p) => [p.feesReward, p.bribeReward]);
    const notifyLogs =
      await getLogsChunked(
        client, rewardAddrs, notifyRewardEvent, startBlock, endBlock, span, pacer, opts.concurrency ?? 5
      );
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
      pacer,
      opts.concurrency ?? 5,
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
