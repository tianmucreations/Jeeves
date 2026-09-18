import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only Jeeves's own tests. The bench's practice jobs carry their own node:test
    // files, which vitest cannot run (and a red run would stop the npm release).
    include: ['tests/**/*.test.ts'],
    // Test files share one settings file, so run them one at a time for stable results.
    fileParallelism: false,
  },
});