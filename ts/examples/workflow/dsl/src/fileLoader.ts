// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Cross-file import resolution for the workflow DSL (Phase 7).
 *
 * `loadModuleTree` performs a BFS over a given entry file, following
 * `import { ... } from "./other.wf"` declarations, returning every
 * file's parsed module plus a flat, alias-resolved list of workflows
 * suitable for handing off to the existing single-source `compile`
 * pipeline (type check, emit).
 *
 * Constraints (v1):
 *  - Imports may only name `export`ed workflows in the source file.
 *  - Two workflows in the transitive set may not share a declared
 *    name; the call graph is therefore globally addressable.
 *  - Aliasing is supported via AST rewrite: every `WorkflowCallExpr`
 *    whose name matches an import alias is rewritten to the
 *    canonical (declared) name before type-check / emit.
 *  - Re-exports are not supported (the parser does not accept them).
 *  - File-level mutual imports are permitted as long as the call
 *    graph remains acyclic (recursion check lives in the type
 *    checker).
 */

import { Module, WorkflowDecl, ImportDecl, Statement, Expr, TaskArg } from "./ast.js";
import { lex } from "./lexer.js";
import { Parser } from "./parser.js";

export interface FileResolver {
    /**
     * Resolve a module specifier (as written in `from "..."`) against
     * the absolute path of the importing file. Implementations should
     * normalize the result so identical files yield identical keys
     * (used for cycle / dedup detection).
     */
    resolve(spec: string, importerAbsPath: string): string;

    /** Read a resolved file as UTF-8 text. */
    read(absPath: string): string;
}

export interface LoadError {
    phase: "lex" | "parse" | "load";
    message: string;
    line: number;
    col: number;
    file?: string;
}

export interface LoadedModule {
    /** Absolute (resolved) path of this file. */
    path: string;
    module: Module;
}

export interface LoadResult {
    /** All transitively-loaded files, in BFS order from the entry. */
    modules: LoadedModule[];
    /** Flat, alias-resolved list of every workflow in the set. */
    workflows: WorkflowDecl[];
    /** The entry file's modules.workflows (used to pick the entry). */
    entryWorkflows: WorkflowDecl[];
    errors: LoadError[];
}

/**
 * Load `entryPath` and all of its transitive imports, alias-resolve
 * `WorkflowCallExpr` references, and return the flat workflow set.
 */
export function loadModuleTree(
    entryPath: string,
    resolver: FileResolver,
): LoadResult {
    const errors: LoadError[] = [];
    const loaded = new Map<string, LoadedModule>();
    // Memo of `resolver.resolve(spec, importer)` results, keyed by the
    // ImportDecl that produced them. The default Node resolver calls
    // `fs.realpathSync` (one syscall) and custom resolvers may be even
    // more expensive or non-idempotent, so we cache during BFS and
    // reuse in Phase 3.
    const importResolutions = new Map<ImportDecl, string>();
    const queue: string[] = [entryPath];

    // Phase 1 — BFS load: lex + parse every transitively-imported
    // file. Imports are followed only after a file parses cleanly.
    while (queue.length > 0) {
        const path = queue.shift()!;
        if (loaded.has(path)) continue;

        let source: string;
        try {
            source = resolver.read(path);
        } catch (e) {
            errors.push({
                phase: "load",
                message: `Cannot read file: ${(e as Error).message}`,
                line: 0,
                col: 0,
                file: path,
            });
            continue;
        }

        const lexResult = lex(source);
        for (const e of lexResult.errors) {
            errors.push({
                phase: "lex",
                message: e.message,
                line: e.line,
                col: e.col,
                file: path,
            });
        }
        if (lexResult.errors.length > 0) continue;

        const parser = new Parser(lexResult.tokens, lexResult.comments);
        const parsed = parser.parseModule();
        for (const e of parsed.errors) {
            errors.push({
                phase: "parse",
                message: e.message,
                line: e.line,
                col: e.col,
                file: path,
            });
        }
        if (parsed.errors.length > 0) continue;

        loaded.set(path, { path, module: parsed.module });

        for (const imp of parsed.module.imports) {
            let resolved: string;
            try {
                resolved = resolver.resolve(imp.source, path);
            } catch (e) {
                errors.push({
                    phase: "load",
                    message: `Cannot resolve import "${imp.source}": ${(e as Error).message}`,
                    line: imp.loc.line,
                    col: imp.loc.col,
                    file: path,
                });
                continue;
            }
            // Cache the resolved path on the ImportDecl so Phase 3
            // doesn't have to call `resolver.resolve` (which can be
            // expensive or non-idempotent) a second time.
            importResolutions.set(imp, resolved);
            if (!loaded.has(resolved)) queue.push(resolved);
        }
    }

    if (errors.length > 0) {
        return { modules: [], workflows: [], entryWorkflows: [], errors };
    }

    // Phase 2 — no global name collision check needed. Every workflow from
    // a non-entry file (exported or private) is mangled with a file-scoped
    // prefix in Phase 4, making all flat-list names globally unique.
    // The only collision that matters is within a single file's local
    // namespace (e.g. importing the same local name from two different
    // files), which is caught by Phase 3.

    // Phase 3 — per-file local-name maps. A local name resolves to a
    // declared (canonical) workflow name.
    //   - declared workflows: local === canonical
    //   - imports: local = alias ?? import.name; canonical = mangled name from source file
    // Validate that imported names are present in the source file and
    // are marked `export`.

    // Pre-compute file indexes here so Phase 3 can resolve mangled canonical names.
    const fileIndexes = new Map<string, number>();
    let fileIdx = 0;
    for (const { path } of loaded.values()) {
        if (fileIndexes.has(path)) {
            // Invariant: BFS dedups by the resolver's normalized path,
            // so this map should be 1:1 with `loaded`. If a future
            // resolver returns non-canonical paths (e.g. different
            // casing or unresolved symlinks), mangling could collide;
            // surface the bug here rather than emit a broken IR.
            errors.push({
                phase: "load",
                message: `Internal: duplicate file path in load set: ${path}`,
                line: 0,
                col: 0,
                file: path,
            });
            continue;
        }
        fileIndexes.set(path, fileIdx++);
    }

    // Helper: returns the mangled canonical name for a workflow in a given file.
    // Entry-file workflows keep their original names; all others are mangled.
    function mangledName(wfName: string, filePath: string): string {
        if (filePath === entryPath) return wfName;
        return `__f${fileIndexes.get(filePath)}_${wfName}`;
    }

    const fileLocalMaps = new Map<string, Map<string, string>>();
    for (const { path, module } of loaded.values()) {
        const local = new Map<string, string>();
        for (const wf of module.workflows) {
            // Own declarations always map local name → mangled canonical name.
            local.set(wf.name, mangledName(wf.name, path));
        }
        for (const imp of module.imports) {
            const sourcePath = importResolutions.get(imp);
            const sourceMod = sourcePath
                ? loaded.get(sourcePath)
                : undefined;
            if (!sourceMod) {
                // Should not happen if BFS succeeded; defensive.
                errors.push({
                    phase: "load",
                    message: `Internal: import source not loaded: ${imp.source}`,
                    line: imp.loc.line,
                    col: imp.loc.col,
                    file: path,
                });
                continue;
            }
            for (const spec of imp.names) {
                const sourceWf = sourceMod.module.workflows.find(
                    (w) => w.name === spec.name,
                );
                if (!sourceWf) {
                    errors.push({
                        phase: "load",
                        message: `Import '${spec.name}' not found in ${imp.source}`,
                        line: spec.loc.line,
                        col: spec.loc.col,
                        file: path,
                    });
                    continue;
                }
                if (!sourceWf.exported) {
                    errors.push({
                        phase: "load",
                        message: `Workflow '${spec.name}' is not exported by ${imp.source}; mark it 'export' to use across files`,
                        line: spec.loc.line,
                        col: spec.loc.col,
                        file: path,
                    });
                    continue;
                }
                const localName = spec.alias ?? spec.name;
                if (local.has(localName)) {
                    errors.push({
                        phase: "load",
                        message: `Import name '${localName}' collides with a local declaration or earlier import`,
                        line: spec.loc.line,
                        col: spec.loc.col,
                        file: path,
                    });
                    continue;
                }
                // Map local alias/name → mangled canonical name in source file.
                local.set(localName, mangledName(spec.name, sourceMod.path));
            }
        }
        fileLocalMaps.set(path, local);
    }

    if (errors.length > 0) {
        return { modules: [], workflows: [], entryWorkflows: [], errors };
    }

    // Phase 4 — AST rewrite + name mangling.
    //
    // All workflows from non-entry files (exported or private) are mangled
    // to `__f{index}_{name}` so the flat merged list is globally unique.
    // Entry-file workflows keep their original names.
    //
    // The per-file local map (built in Phase 3) already maps original names
    // to mangled canonical names, so the AST rewriter transparently rewrites
    // all call references to their mangled targets.
    const workflows: WorkflowDecl[] = [];
    for (const { path, module } of loaded.values()) {
        const local = fileLocalMaps.get(path)!;

        for (const wf of module.workflows) {
            // Mangle the declaration name for all non-entry-file workflows.
            if (path !== entryPath) {
                wf.name = mangledName(wf.name, path);
            }
            for (const param of wf.params) {
                if (param.default) {
                    rewriteExpr(param.default, local);
                }
            }
            rewriteWorkflowCalls(wf.body, local);
            workflows.push(wf);
        }
    }

    const entryFile = loaded.get(entryPath);
    // entryWorkflows: use the already-mangled names from the entry file's workflows.
    const entryWorkflows = entryFile ? entryFile.module.workflows : [];
    return {
        modules: [...loaded.values()],
        workflows,
        entryWorkflows,
        errors,
    };
}

function rewriteWorkflowCalls(
    stmts: Statement[],
    local: Map<string, string>,
): void {
    for (const s of stmts) {
        rewriteStmt(s, local);
    }
}

function rewriteStmt(s: Statement, local: Map<string, string>): void {
    switch (s.kind) {
        case "ConstStatement":
            rewriteExpr(s.value, local);
            return;
        case "DestructuringConst":
            rewriteExpr(s.value, local);
            return;
        case "ReturnStatement":
            rewriteExpr(s.value, local);
            return;
        case "IfStatement":
            rewriteExpr(s.condition, local);
            rewriteWorkflowCalls(s.then, local);
            if (s.else_) rewriteWorkflowCalls(s.else_, local);
            return;
        case "SwitchStatement":
            rewriteExpr(s.discriminant, local);
            for (const arm of s.arms) {
                rewriteExpr(arm.value, local);
                rewriteWorkflowCalls(arm.body, local);
            }
            if (s.default_) rewriteWorkflowCalls(s.default_, local);
            return;
        case "ThrowStatement":
            rewriteExpr(s.value, local);
            return;
        case "BreakStatement":
            return;
    }
}

function rewriteExpr(e: Expr, local: Map<string, string>): void {
    switch (e.kind) {
        case "WorkflowCallExpr": {
            const canonical = local.get(e.name);
            if (canonical) e.name = canonical;
            for (const a of e.args) rewriteArg(a, local);
            return;
        }
        case "TaskCallExpr":
            for (const a of e.args) rewriteArg(a, local);
            return;
        case "TemplateLiteralExpr":
            for (const x of e.expressions) rewriteExpr(x, local);
            return;
        case "BinaryExpr":
            rewriteExpr(e.left, local);
            rewriteExpr(e.right, local);
            return;
        case "UnaryExpr":
            rewriteExpr(e.operand, local);
            return;
        case "TernaryExpr":
            rewriteExpr(e.condition, local);
            rewriteExpr(e.consequent, local);
            rewriteExpr(e.alternate, local);
            return;
        case "ArrayLiteralExpr":
            for (const el of e.elements) rewriteExpr(el, local);
            return;
        case "ObjectLiteralExpr":
            for (const f of e.entries) rewriteExpr(f.value, local);
            return;
        case "AttemptsNode":
            rewriteExpr(e.count, local);
            rewriteWorkflowCalls(e.body, local);
            if (e.fallback) rewriteWorkflowCalls(e.fallback.body, local);
            return;
        case "MapNode":
        case "FilterNode":
            rewriteExpr(e.collection, local);
            rewriteWorkflowCalls(e.body, local);
            return;
        case "ParallelNode":
            for (const b of e.bodies) rewriteWorkflowCalls(b.body, local);
            if (e.maxConcurrency) rewriteExpr(e.maxConcurrency, local);
            return;
        case "ParallelMapNode":
            rewriteExpr(e.collection, local);
            rewriteWorkflowCalls(e.body, local);
            if (e.maxConcurrency) rewriteExpr(e.maxConcurrency, local);
            return;
        // No nested Exprs: DottedNameExpr, StringLiteralExpr,
        // NumberLiteralExpr, BooleanLiteralExpr, NullLiteralExpr.
        default:
            return;
    }
}

function rewriteArg(a: TaskArg, local: Map<string, string>): void {
    rewriteExpr(a.value, local);
}
