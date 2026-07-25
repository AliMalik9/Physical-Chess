import {fileURLToPath, URL} from "node:url";
import react from "@vitejs/plugin-react";
import {defineConfig} from "vitest/config";

// The Cloudflare plugin is deliberately absent here. Unit tests exercise the
// room state machine and pure helpers directly, without a Workers runtime.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["e2e/**"],
  },
});
