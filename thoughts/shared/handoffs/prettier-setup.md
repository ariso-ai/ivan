# Prettier Setup Handoff

**Goal:** Add Prettier to this TypeScript/Node.js codebase with minimal config that matches existing conventions, and wire it into ESLint to avoid conflicts.

---

## Codebase Conventions (from eslint.config.js)

These are the current formatting rules enforced by ESLint:

| Rule | Setting |
|------|---------|
| Semicolons | always |
| Quotes | single |
| Indent | 2 spaces |
| Trailing commas | never |
| Trailing whitespace | not allowed |
| Final newline | required |
| Line endings | LF (via .editorconfig) |

---

## Prettier Config

Create `.prettierrc.json` at the repo root with only the two non-default values:

```json
{
  "singleQuote": true,
  "trailingComma": "none"
}
```

**Why only two options?** Prettier 3 defaults already match the codebase:
- `semi: true` — default ✓
- `tabWidth: 2` — default ✓
- `useTabs: false` — default ✓
- `printWidth: 80` — default, leave as-is ✓

Prettier also reads `.editorconfig` automatically, so `end_of_line`, `insert_final_newline`, and `trim_trailing_whitespace` are already covered.

---

## Install

```bash
npm install --save-dev prettier eslint-config-prettier
```

- `prettier` — the formatter
- `eslint-config-prettier` — disables ESLint rules that conflict with Prettier (do NOT install `eslint-plugin-prettier`; running Prettier as an ESLint rule is slow and redundant in 2025)

---

## Update eslint.config.js

Import and add `eslint-config-prettier` at the **end** of the config array (it must come last to win). Also remove the four formatting rules that Prettier now owns:

```js
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';  // ADD THIS

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { /* unchanged */ }
    },
    plugins: {
      '@typescript-eslint': typescript
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        args: 'after-used',
        caughtErrors: 'all'
      }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': 'off',
      'no-unused-vars': 'off',
      // REMOVE: 'semi', 'quotes', 'indent', 'comma-dangle', 'no-trailing-spaces', 'eol-last'
      // Prettier owns all of these now
    }
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js']
  },
  prettier  // ADD THIS — must be last
];
```

---

## Add npm Scripts

Add to `package.json` scripts:

```json
"format": "prettier --write \"src/**/*.{ts,json}\"",
"format:check": "prettier --check \"src/**/*.{ts,json}\""
```

---

## One-Time Format Pass

After setup, run once to normalize the existing codebase:

```bash
npm run format
```

Then commit the result as a single formatting commit so it doesn't pollute git blame.

---

## Verify No ESLint Conflicts

```bash
npm run lint
```

Should pass cleanly. If there are conflicts, `eslint-config-prettier` is likely not last in the config array.

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `.prettierrc.json` | Create new — 2 options |
| `eslint.config.js` | Add prettier import, remove 6 formatting rules, append prettier to array |
| `package.json` | Add `format` and `format:check` scripts, add 2 devDependencies |
