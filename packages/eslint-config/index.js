import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * Shared flat ESLint config for Virtual HEMS TypeScript packages.
 * Consume from a package `eslint.config.js` with:
 *   import config from "@virtualhems/eslint-config";
 *   export default config;
 */
export default tseslint.config(
  {
    ignores: ["dist/**", ".next/**", "coverage/**", ".turbo/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
