import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["{apps,packages,tools}/*/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["{apps,packages,tools}/*/test/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 240_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
