import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "public/**",
      "node_modules/**",
    ],
  },
  {
    // Guards K-1 (Airtable audit finding): base/table IDs must live only in
    // src/lib/airtable-schema.ts. A literal here means a table got hardcoded
    // again somewhere instead of importing the shared constant, which is
    // exactly the drift that let the public site and the importer silently
    // point at different tables.
    files: ["src/**/*.{ts,tsx,mts,mjs,js}"],
    ignores: ["src/lib/airtable-schema.ts"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // Scoped to `const X = 'literal'` (the historical anti-pattern —
          // e.g. `const STOPS_TABLE = 'tblpa3Zof1ZGofAtS'`), not any 17-char
          // identifier-shaped string. A selector matching all Literal nodes
          // would also flag unrelated camelCase strings that happen to be the
          // same length (e.g. an action name like 'approveAndPublish').
          selector: "VariableDeclarator > Literal[value=/^(tbl|app)[A-Za-z0-9]{14}$/]",
          message:
            "Hardcoded Airtable base/table ID literal — import the named constant from '@/lib/airtable-schema' instead.",
        },
      ],
    },
  },
];

export default eslintConfig;
