import { defineConfig } from 'vitest/config';

// Reproductions of known defects: they pass while a defect exists, so they are kept out of
// `npm test` (see vitest.config.ts) and run on demand with `npm run test:known-defects`.
export default defineConfig({
    test: {
        include: ['tests/known-defects/**/*.repro.ts']
    }
});
