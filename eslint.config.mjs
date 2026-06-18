import js from '@eslint/js'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  {
    ignores: ['node_modules', 'dist'],
  },
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
])
