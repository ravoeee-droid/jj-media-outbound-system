import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The app intentionally initializes UI state from URL/API effects. These are
    // synchronization effects, not render-time derived state. React 19's optional
    // compiler lint is stricter than the runtime contract here.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  {
    // Baileys exports useMultiFileAuthState; despite its name it is a Node helper,
    // not a React Hook. The bridge is syntax-checked separately in CI.
    files: ["services/**/*.mjs"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
