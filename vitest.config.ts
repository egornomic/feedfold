import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      // Measure application logic, including files the tests have not imported yet.
      // UI rendering and process entry points need separate browser/packaged-app coverage.
      include: [
        "src/client/**/*.ts",
        "src/client/ai-markdown.tsx",
        "src/server/**/*.ts",
        "src/shared/**/*.ts",
        "src/demo/store.ts",
        "src/desktop/youtube-player.ts",
      ],
      exclude: ["**/*.d.ts", "src/server/index.ts", "src/server/manage-accounts.ts"],
      reporter: ["text-summary", "html", "json-summary", "lcov"],
      reportOnFailure: true,
      thresholds: {
        statements: 69,
        branches: 60,
        functions: 70,
        lines: 72,
      },
    },
  },
});
