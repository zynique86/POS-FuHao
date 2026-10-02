import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler advisory rules that flag legitimate, working patterns in
      // this app (fetch-on-mount, Date.now() for "time ago", a chart-offset
      // accumulator). Keep them visible as warnings rather than build-blocking
      // errors.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The printer service is a standalone CommonJS Node app (not part of the
    // Next.js build) — it legitimately uses require(), so skip it here.
    "printer-service/**",
  ]),
]);

export default eslintConfig;
