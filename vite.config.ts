import {fileURLToPath, URL} from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {defineConfig} from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // VITE_ is the preferred Vite convention. Accept NEXT_PUBLIC_ as well so an
  // existing Vercel setup can use its already-configured public Supabase values.
  // Neither prefix may contain a secret/service-role key.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
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
    sourcemap: false,
  },
});
