import { describe, expect, it } from "vitest";
import { getLogsChunked, Pacer, type IndexerClient } from "../src/data/indexer.js";

/** Fake client: records in-flight high-water mark and per-call ranges,
 * returns one synthetic "log" per chunk tagged with its range. */
function fakeClient(latencyMs: number) {
  let inFlight = 0;
  const stats = { maxInFlight: 0, calls: [] as { from: bigint; to: bigint; startedAt: number }[] };
  const client = {
    async getLogs(args: { fromBlock: bigint; toBlock: bigint }) {
      inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      stats.calls.push({ from: args.fromBlock, to: args.toBlock, startedAt: Date.now() });
      await new Promise((r) => setTimeout(r, latencyMs));
      inFlight--;
      return [{ tag: `${args.fromBlock}-${args.toBlock}` }];
    },
  };
  return { client: client as unknown as IndexerClient, stats };
}

// The event argument is only forwarded to the client; the fake ignores it.
const EVENT = undefined as never;

describe("getLogsChunked bounded concurrency", () => {
  it("splits [from,to] into inclusive span-sized chunks covering every block once", async () => {
    const { client, stats } = fakeClient(1);
    await getLogsChunked(client, [], EVENT, 100n, 350n, 100n, undefined, 3);
    expect(stats.calls.map((c) => `${c.from}-${c.to}`).sort()).toEqual(
      ["100-199", "200-299", "300-350"].sort(),
    );
  });

  it("never exceeds the concurrency bound and beats sequential wall time", async () => {
    const { client, stats } = fakeClient(30);
    const t0 = Date.now();
    await getLogsChunked(client, [], EVENT, 0n, 7_999n, 1_000n, undefined, 4); // 8 chunks
    const elapsed = Date.now() - t0;
    expect(stats.maxInFlight).toBeLessThanOrEqual(4);
    expect(stats.maxInFlight).toBeGreaterThan(1); // concurrency actually engaged
    expect(elapsed).toBeLessThan(8 * 30); // strictly better than sequential
  });

  it("flattens results in deterministic chunk order regardless of completion order", async () => {
    const { client } = fakeClient(5);
    const logs = (await getLogsChunked(client, [], EVENT, 0n, 4_999n, 1_000n, undefined, 5)) as {
      tag: string;
    }[];
    expect(logs.map((l) => l.tag)).toEqual([
      "0-999",
      "1000-1999",
      "2000-2999",
      "3000-3999",
      "4000-4999",
    ]);
  });

  it("respects the shared rps budget across concurrent workers", async () => {
    const { client, stats } = fakeClient(1);
    const rps = 50;
    await getLogsChunked(client, [], EVENT, 0n, 9_999n, 1_000n, new Pacer(rps), 10); // 10 chunks
    const starts = stats.calls.map((c) => c.startedAt).sort((a, b) => a - b);
    // 10 request starts at 50 rps must span ≥ 9 × 20ms (allow timer slop).
    expect(starts[starts.length - 1]! - starts[0]!).toBeGreaterThanOrEqual(9 * 20 - 15);
  });

  it("rejects invalid parameters", async () => {
    const { client } = fakeClient(1);
    await expect(getLogsChunked(client, [], EVENT, 0n, 10n, 0n)).rejects.toThrow(/logSpan/);
    await expect(getLogsChunked(client, [], EVENT, 0n, 10n, 5n, undefined, 0)).rejects.toThrow(
      /concurrency/,
    );
  });
});
