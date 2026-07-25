import {fileURLToPath, URL} from "node:url";
import {cloudflare} from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {defineConfig} from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    // Chunking is left to the bundler. The split that matters is expressed in
    // the code as dynamic imports — the room, the board surface, the QR
    // encoder and the start dialog — and hand-tuned manualChunks only pulled
    // those back into the entry's static graph.
    target: "es2022",
    sourcemap: true,
  },
});
