import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'node_modules/',
      'coverage/',
      'dist/',
      'build/',
      'data/',
      '**/*.min.js',
      'vibe-prototype/',
      '.specify/',
      '.claude/',
    ],
  },
  tseslint.configs.recommended,
);
