import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import modernNext, { legacyModules } from "./tools/eslint/modern-next.mjs";
import asyncCallbacks from "./tools/eslint/async-callbacks.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "src/types/komari-api.d.ts",
    ".pi/**",
    ".agents/worktrees/**",
    ".codeartsdoer/**",
    ".playwright-mcp/**",
    "docs/**",
    "openapi/**",
  ]),
  {
    plugins: {
      komari: {
        ...modernNext,
        rules: { ...modernNext.rules, "no-misused-promises": asyncCallbacks },
      },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "komari/app-router-only": "error",
      "komari/modern-next-components": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...legacyModules.map((name) => ({
              name,
              message: "Use Next.js 16 App Router APIs, not legacy entry points.",
            })),
            {
              name: "next",
              importNames: [
                "NextApiRequest", "NextApiResponse", "NextApiHandler",
                "GetServerSideProps", "GetServerSidePropsContext",
                "GetStaticProps", "GetStaticPropsContext", "GetStaticPaths",
                "GetStaticPathsContext", "InferGetServerSidePropsType",
                "InferGetStaticPropsType",
              ],
              message: "Use App Router route types and Web Request/Response APIs.",
            },
          ],
        },
      ],
      "no-restricted-modules": ["error", ...legacyModules],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": true,
          "ts-check": false,
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        // Application files use tsconfig.json; the Next config is the one
        // handwritten TS entry point outside its include list.
        projectService: { allowDefaultProject: ["next.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: false, ignoreIIFE: false, checkThenables: true },
      ],
      // The adapter runs the upstream rule unchanged except this reviewed slot.
      // Ant Design 6.3.5 Popconfirm forwards onConfirm's Promise to ActionButton
      // for loading/close behavior, although PopconfirmProps declares void.
      "@typescript-eslint/no-misused-promises": "off",
      "komari/no-misused-promises": [
        "error",
        { allowedCallbacks: [{ source: "antd", name: "Popconfirm", attribute: "onConfirm" }] },
      ],
      "@typescript-eslint/await-thenable": "error",
    },
  },
]);

export default eslintConfig;
