import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve("scripts/officePreview/benchmark"),
  base: "./",
  plugins: [react()],
  build: { outDir: path.resolve("temp/office-benchmark/dist"), emptyOutDir: true },
});
