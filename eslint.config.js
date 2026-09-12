const nextPlugin = require("@next/eslint-plugin-next");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
  {
    files: ["**/*.{js,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: nextPlugin.configs.recommended.rules,
  },
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "node_modules/**",
      ".local/**",
      ".beads/**",
      ".beads.backup-20260827/**",
      ".serena/**",
    ],
  },
];
