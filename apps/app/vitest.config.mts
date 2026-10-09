import { defineConfig } from 'vitest/config';

// Unit tests run the web target: react-native resolves to react-native-web in jsdom (the "web
// preset"), screens render with Testing Library. test/web.test.ts drives the exported build in
// Chromium and runs in Node.
export default defineConfig({
  resolve: {
    alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
  },
  define: { __DEV__: 'false' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/worker.test.ts'],
          setupFiles: ['./test/setup.tsx'],
        },
      },
      {
        extends: true,
        test: { name: 'worker', environment: 'node', include: ['src/worker.test.ts'] },
      },
      {
        test: {
          name: 'web',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
