import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const coverageShard = process.env.FEEDFOLD_COVERAGE_SHARD === "true";

class DistributedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    // Spread adjacent browser suites across runners instead of hashing them into one shard.
    return [...files]
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
      .filter((_, index) => index % shard.count === shard.index - 1);
  }
}

export default defineConfig({
  test: {
    sequence: { sequencer: DistributedSequencer },
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
        "src/client/features/reader/article/ai-markdown.tsx",
        "src/server/**/*.ts",
        "src/shared/**/*.ts",
        "src/demo/store.ts",
        "src/desktop/youtube-player.ts",
      ],
      exclude: ["**/*.d.ts", "src/server/index.ts", "src/server/manage-accounts.ts"],
      reporter: coverageShard ? [] : ["text-summary", "html", "json-summary", "lcov"],
      reportOnFailure: true,
      // Enforce the full-suite thresholds after merging every shard's coverage.
      thresholds: coverageShard
        ? {}
        : {
            statements: 69,
            branches: 60,
            functions: 70,
            lines: 72,
          },
    },
  },
});
