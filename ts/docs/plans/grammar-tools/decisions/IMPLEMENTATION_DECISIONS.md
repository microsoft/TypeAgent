# Implementation Decisions Log

Decisions made during scaffold implementation (0c, D.0, E.0) that
are not explicitly spelled out in PLAN.md or design docs.

## Package structure

1. **Nested workspace glob**: Added `packages/grammarTools/*` to
   `pnpm-workspace.yaml` (after `packages/*`) so all sub-packages
   under `grammarTools/` are auto-detected.

2. **Package naming**: Used `grammar-tools-core`, `grammar-tools-ui`,
   and `grammar-tools-cli` (kebab-case npm names). Directory names are
   camelCase (`grammarTools/core`, `grammarTools/ui`, `grammarTools/cli`).

3. **No tsconfig project references to action-grammar**: Rely on
   pnpm workspace symlinks for module resolution (same as other
   packages in the repo like actionGrammarCompiler).

## Core package (grammar-tools-core)

4. **loadGrammarRules over parseGrammarRules for loading**: The loader
   uses `loadGrammarRules` (parse + compile) rather than the raw parser,
   since we need a compiled `Grammar` object for completion/matching.

5. **parseGrammarRules for formatting**: The formatter uses
   `parseGrammarRules` + `writeGrammarRules` (parse-AST round-trip)
   since `writeGrammarRules` accepts `GrammarParseResult`, not `Grammar`.

6. **PartId scheme**: Placeholder `ruleIndex * 1000 + partIndex` until
   debug info from the compiler provides stable part IDs.

7. **SeparatorMode exported from action-grammar**: Added to
   action-grammar's public barrel (`index.ts`) since it was already
   effectively public via `GrammarCompletionGroup.separatorMode`.
   grammar-tools-core re-exports it rather than duplicating.

8. **GrammarRule/GrammarPart not re-exported**: These are internal to
   action-grammar (not in public exports). Our types only re-export
   `Grammar`.

9. **Completion properties non-optional**: `CompletionPreview.properties`
   is `CompletionProperty[]` (not `| undefined`) - we coalesce with `?? []`
   at the boundary for cleaner downstream consumption.

## UI package (grammar-tools-ui)

10. **Vite library mode with lit external**: Lit is externalized in
    the Vite bundle so hosts can share a single Lit instance. This
    matches how VS Code webview extensions typically bundle.

11. **experimentalDecorators + useDefineForClassFields: false**: Required
    for Lit decorator support with TypeScript 5.x (Lit's `@customElement`
    and `@property` decorators use legacy TC39 decorator semantics).

12. **DOM lib added to tsconfig**: UI package adds `"lib": ["es2021", "DOM"]`
    since components use browser APIs.

13. **CSS custom properties convention**: All theming goes through
    `--gt-*` tokens which fall back to `--vscode-*` tokens. No hard-coded
    colors in component styles.

## CLI (grammar-tools-cli)

14. **Placed in packages/grammarTools/cli**: Colocated with its siblings
    (`core/`, `ui/`) for discoverability. Already covered by the
    `packages/grammarTools/*` workspace glob.

15. **No interactive REPL yet**: The CLI provides one-shot commands
    (`load`, `complete`, `format`). Interactive mode deferred to
    chunk 03+ per plan phasing.
