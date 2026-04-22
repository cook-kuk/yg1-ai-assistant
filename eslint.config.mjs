import nextCoreWebVitals from "eslint-config-next/core-web-vitals"

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "eval/**",
      "scripts/**",
      "public/**",
      "benchmark-results/**",
      "_archive/**",
      "python-api/**",
      "logs/**",
      "data/**",
      "e2e/**",
      "real_test/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    // Global rule overrides (applies to JS/TS)
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      // Relax react-hooks compiler/lint rules to warnings so existing code
      // does not block builds. Raise to "error" selectively when desired.
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  {
    // TypeScript-only rule overrides (plugin is only loaded for .ts/.tsx)
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
]
