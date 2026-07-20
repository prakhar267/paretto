import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { frenchAudioManifest } from "./build/french-audio-manifest-plugin";

export default defineConfig({
  plugins: [frenchAudioManifest()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/cloudflare-workers-mock.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    reporters: ["default"],
  },
});
