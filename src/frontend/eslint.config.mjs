import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: [".next/**", "node_modules/**", "playwright-report/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@next/next": nextPlugin, "@typescript-eslint": tsPlugin },
    rules: {
      "no-debugger": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      ...nextPlugin.configs.recommended.rules,
    },
  },
];
