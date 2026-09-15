import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files share one settings file, so run them one at a time for stable results.
    fileParallelism: false,
  },
});