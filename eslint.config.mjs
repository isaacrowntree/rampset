import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** Next.js 16 ships native ESLint flat configs, so they're composed directly
 * (no FlatCompat shim). core-web-vitals + typescript mirror the defaults
 * create-next-app scaffolds. */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
      ".wrangler/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // react-hooks v6 (shipped with Next 16) adds React-Compiler-oriented
      // rules that flag deliberate, tested patterns here: the "latest ref"
      // pattern (draftRef.current = draft), init-from-storage effects, and a
      // render-time cursor in the plate geometry. Kept as warnings — visible
      // for future review without failing the build on intended code.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      // Allow intentionally-unused args/vars via a leading underscore.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
