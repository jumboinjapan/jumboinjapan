import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 отдаёт готовые flat-конфиги массивами, поэтому
 * прослойка FlatCompat из @eslint/eslintrc больше не нужна — с ней ESLint
 * падает на «Converting circular structure to JSON» ещё до первого файла.
 */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "public/**",
      "node_modules/**",
      // Одноразовые превью дизайна: браузерные сниппеты, которые открывают
      // в консоли DevTools. Это не код приложения — там свои глобальные
      // объекты и свой жизненный цикл, линтеру их проверять нечем.
      "docs/design-previews/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Скрипты для консоли браузера: document, window и прочие DOM-глобали
    // приходят из страницы, а не из Node.
    files: ["scripts/browser/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
        location: "readonly",
        Event: "readonly",
        HTMLElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLInputElement: "readonly",
        console: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    // ── Долг React Compiler, зафиксирован 2026-08-09 ────────────────────────
    // eslint-config-next 16 включил правила компилятора React. На текущем коде
    // они дают 28 срабатываний, все — в давно написанных экранах админки:
    //   24 × set-state-in-effect (каскадные ререндеры; больше всего в
    //        AdminOperationsConsole, MultiDayBuilderWorkspace, RouteStopsEditor)
    //    3 × purity (Date.now() на рендере)
    //    1 × static-components (компонент создаётся внутри рендера,
    //        MultiDayBuilderWorkspace:2696)
    // Это не регрессия от обновления — это то, что старый конфиг не видел.
    // Чинить их вперемешку с гигиеной репозитория нельзя: правки лягут в
    // модули на 1400–3300 строк, которые сами стоят в очереди на разделение.
    // Понижены до warn, чтобы линтер снова стал воротами для НОВЫХ ошибок.
    // Поднимать обратно по одному правилу, когда экран разобран.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
    },
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
      // Появление динамических сегментов intercity/[slug] и city-tour/[slug]
      // (Б-1) активировало это правило для ~57 давних <a href="/intercity/…">
      // по статическим страницам. Понижено до warn; конвертация на next/link
      // (client-side nav + prefetch) — отдельный механический заход в бэклоге.
      "@next/next/no-html-link-for-pages": "warn",
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
