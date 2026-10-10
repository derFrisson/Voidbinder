import { defineConfig } from 'eslint/config';
import root from '../../eslint.config.js';

// The repository's rules, plus what an Expo app needs: Metro and Babel configs are CommonJS, and
// Metro loads assets (fonts) through require().
export default defineConfig({ ignores: ['.expo/**'] }, root, {
  files: ['*.config.js', 'src/fonts.ts', 'tailwind.config.ts'],
  rules: { '@typescript-eslint/no-require-imports': 'off' },
});
