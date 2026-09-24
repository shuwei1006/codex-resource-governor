import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
  rules: {'@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}]}
}, {files: ['tests/fixtures/*.mjs'], languageOptions: {globals: {process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly'}}});
