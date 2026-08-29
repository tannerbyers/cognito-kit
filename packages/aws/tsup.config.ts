import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    sdk: "src/sdk.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  outDir: "dist",
})