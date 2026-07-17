import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DATASET = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/aerodrome.json");

/**
 * Ship the CI-built historical dataset (data/aerodrome.json, committed to the
 * repo by data.yml) as a static asset of the site (plan §8: the site fetches
 * plain JSON, never an RPC — P7). Every weekly data commit re-triggers the
 * Pages build, so the deployed copy tracks the repo automatically. Absence is
 * tolerated: the app falls back to the synthetic epoch dataset.
 */
function liveDatasetPlugin(): Plugin {
  return {
    name: "aero-live-dataset",
    buildStart() {
      if (!existsSync(DATASET)) {
        this.warn("data/aerodrome.json not found — site ships without the historical dataset");
        return;
      }
      this.emitFile({
        type: "asset",
        fileName: "data/aerodrome.json",
        source: readFileSync(DATASET),
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0]?.endsWith("/data/aerodrome.json") && existsSync(DATASET)) {
          res.setHeader("Content-Type", "application/json");
          res.end(readFileSync(DATASET));
          return;
        }
        next();
      });
    },
  };
}

// GitHub Pages serves from /aero-autopilot/; CI sets VITE_BASE_PATH so a later
// Vercel migration is one env-var flip, zero code changes (plan §8).
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), liveDatasetPlugin()],
  worker: { format: "es" },
});
