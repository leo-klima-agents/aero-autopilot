import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves from /aero-autopilot/; CI sets VITE_BASE_PATH so a later
// Vercel migration is one env-var flip, zero code changes (plan §8).
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  worker: { format: "es" },
});
