import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { viteDevServerConfig } from "./server/dev-mode.js";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: viteDevServerConfig,
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/e2e/**", "**/node_modules/**", "src-tauri/target/**", "src-tauri/resources/**", "launcher-release/**"],
  },
});
