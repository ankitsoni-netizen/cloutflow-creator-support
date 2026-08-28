import path from "node:path";
import { defineConfig } from "vitest/config";

const aliases = {
  "@": path.resolve(__dirname, "."),
  "server-only": path.resolve(__dirname, "test/shims/server-only.ts"),
};

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    environment: "node",
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: "unit",
          environment: "node",
          include: ["lib/**/__tests__/**/*.test.ts"],
          exclude: ["lib/**/__tests__/**/*.pglite.test.ts"],
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: "pglite",
          environment: "node",
          include: ["lib/**/__tests__/**/*.pglite.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
  },
});
