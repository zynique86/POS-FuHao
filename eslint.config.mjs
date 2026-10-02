import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This app loads data on mount with useEffect + setState throughout
      // (fetch-on-mount). That's a legitimate, working pattern, so keep it a
      // warning rather than a build-blocking error.
      "react-hooks/set-state-in-effect": "warn",
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
