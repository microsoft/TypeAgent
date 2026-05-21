// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL compiler: source text -> WorkflowIR.
 *
 * This is the public API. It orchestrates: lex -> parse -> emit.
 */

import { WorkflowIR, validateWorkflowIR } from "workflow-model";
import * as fs from "node:fs";
import * as path from "node:path";
import { lex } from "./lexer.js";
import { Parser } from "./parser.js";
import { TypeChecker } from "./typeChecker.js";
import { Emitter, TaskSchemaInfo } from "./emitter.js";
import { loadModuleTree, FileResolver, LoadError } from "./fileLoader.js";

export interface CompileError {
    phase: "lex" | "parse" | "typecheck" | "emit" | "validate";
    message: string;
    line: number;
    col: number;
}

export interface CompileOptions {
    /** Run IR validation after emit. Defaults to false. */
    validate?: boolean;
    /**
     * Name of the workflow to use as the IR entry point. Defaults to:
     *  - the only workflow in the file, if there is exactly one;
     *  - the only `export workflow` declaration, if exactly one is
     *    marked exported;
     *  - otherwise a compile error (caller must specify).
     * Phase 6 wires this to the `wfc` CLI's `--entry` flag.
     */
    entry?: string;
}

export interface CompileResult {
    ir?: WorkflowIR | undefined;
    errors: CompileError[];
}

export function compile(
    source: string,
    taskSchemas: TaskSchemaInfo[],
    options?: CompileOptions,
): CompileResult {
    const errors: CompileError[] = [];

    // Lex
    const { tokens, errors: lexErrors, comments } = lex(source);
    for (const e of lexErrors) {
        errors.push({
            phase: "lex",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }
    if (lexErrors.length > 0) {
        return { errors };
    }

    // Parse (multi-workflow). The Phase 3 type checker needs the full
    // workflow table to resolve `WorkflowCallExpr`, so we use parse()
    // (which returns every workflow) instead of parseSingle().
    const parser = new Parser(tokens, comments);
    const { workflows, errors: parseErrors } = parser.parse();
    for (const e of parseErrors) {
        errors.push({
            phase: "parse",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }
    if (workflows.length === 0 || parseErrors.length > 0) {
        return { errors };
    }

    // Type check all workflows together so cross-workflow calls
    // resolve and recursion is detectable.
    const checker = new TypeChecker(taskSchemas);
    const typeErrors = checker.checkAll(workflows);
    for (const e of typeErrors) {
        errors.push({
            phase: "typecheck",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }
    if (typeErrors.length > 0) {
        return { errors };
    }

    // Pick the entry workflow. Phase 4 will rewire the emitter to take
    // the full workflow list and emit a workflow table; until then we
    // emit only the entry workflow so existing IR consumers keep
    // working.
    const entry = selectEntry(workflows, options?.entry);
    if (!entry.ok) {
        errors.push({
            phase: "typecheck",
            message: entry.message,
            line: entry.line,
            col: entry.col,
        });
        return { errors };
    }

    // Emit
    const emitter = new Emitter(taskSchemas);
    const { ir, errors: emitErrors } = emitter.emitAll(
        workflows,
        entry.value.name,
    );
    for (const e of emitErrors) {
        errors.push({
            phase: "emit",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }

    maybeValidate(ir ?? null, errors, options);

    return { ir: ir ?? undefined, errors };
}

type EntrySelection =
    | { ok: true; value: import("./ast.js").WorkflowDecl }
    | { ok: false; message: string; line: number; col: number };

function selectEntry(
    workflows: import("./ast.js").WorkflowDecl[],
    requested: string | undefined,
): EntrySelection {
    if (requested) {
        const found = workflows.find((w) => w.name === requested);
        if (!found) {
            return {
                ok: false,
                message: `Entry workflow '${requested}' not found in source`,
                line: 0,
                col: 0,
            };
        }
        return { ok: true, value: found };
    }
    if (workflows.length === 1) {
        return { ok: true, value: workflows[0] };
    }
    const exported = workflows.filter((w) => w.exported);
    if (exported.length === 1) {
        return { ok: true, value: exported[0] };
    }
    if (exported.length === 0) {
        return {
            ok: false,
            message: `Multiple workflows declared but none marked 'export'; mark one as the entry or pass --entry`,
            line: workflows[0].loc.line,
            col: workflows[0].loc.col,
        };
    }
    return {
        ok: false,
        message: `Multiple 'export workflow' declarations (${exported
            .map((w) => `'${w.name}'`)
            .join(", ")}); choose one with --entry`,
        line: workflows[0].loc.line,
        col: workflows[0].loc.col,
    };
}

function maybeValidate(
    ir: WorkflowIR | null,
    errors: CompileError[],
    options?: CompileOptions,
): void {
    if (!options?.validate || !ir || errors.length > 0) return;
    const result = validateWorkflowIR(ir);
    for (const e of result.errors) {
        errors.push({
            phase: "validate",
            message: `${e.path}: ${e.message}`,
            line: 0,
            col: 0,
        });
    }
}

/**
 * Multi-file compile: load `entryPath`, follow `import { … } from "./other.wf"`
 * declarations transitively via the supplied `resolver` (or the default
 * Node fs/path resolver), then run the standard type-check + emit
 * pipeline against the merged flat workflow set.
 *
 * Phase 7 of the workflow-composition implementation plan.
 */
export function compileFile(
    entryPath: string,
    taskSchemas: TaskSchemaInfo[],
    options?: CompileOptions & {
        resolver?: FileResolver;
        /**
         * If set, the default Node resolver will reject any import that
         * resolves to a path outside this directory. Has no effect if a
         * custom `resolver` is supplied. Off by default (matches the
         * convention of `tsc`, esbuild, swc, etc.).
         */
        workspaceRoot?: string;
    },
): CompileResult {
    const errors: CompileError[] = [];
    const resolver =
        options?.resolver ?? createNodeResolver(options?.workspaceRoot);
    const load = loadModuleTree(entryPath, resolver);
    for (const e of load.errors) {
        errors.push(loadErrorToCompileError(e));
    }
    if (errors.length > 0) return { errors };

    const workflows = load.workflows;
    const entryWorkflows = load.entryWorkflows;

    // Type check
    const checker = new TypeChecker(taskSchemas);
    const typeErrors = checker.checkAll(workflows);
    for (const e of typeErrors) {
        errors.push({
            phase: "typecheck",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }
    if (typeErrors.length > 0) return { errors };

    // Entry selection — restricted to the entry file's workflows, so
    // that imports don't accidentally become the entry point.
    const entry = selectEntry(entryWorkflows, options?.entry);
    if (!entry.ok) {
        errors.push({
            phase: "typecheck",
            message: entry.message,
            line: entry.line,
            col: entry.col,
        });
        return { errors };
    }

    const emitter = new Emitter(taskSchemas);
    const { ir, errors: emitErrors } = emitter.emitAll(
        workflows,
        entry.value.name,
    );
    for (const e of emitErrors) {
        errors.push({
            phase: "emit",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }

    maybeValidate(ir ?? null, errors, options);
    return { ir: ir ?? undefined, errors };
}

function loadErrorToCompileError(e: LoadError): CompileError {
    const phase: CompileError["phase"] =
        e.phase === "lex"
            ? "lex"
            : e.phase === "parse"
              ? "parse"
              : // "load" errors are reported under the typecheck phase so
                // they appear in the same diagnostic stream as
                // visibility / unknown-name errors.
                "typecheck";
    return {
        phase,
        message: e.file ? `${e.file}: ${e.message}` : e.message,
        line: e.line,
        col: e.col,
    };
}

/**
 * Default file resolver: maps relative specifiers (`./foo.wf`,
 * `../bar.wf`) against the importing file's directory, normalizing
 * the result. Absolute and workspace-rooted specifiers are not
 * supported in v1.
 */
function createNodeResolver(workspaceRoot?: string): FileResolver {
    const root = workspaceRoot
        ? fs.realpathSync(path.resolve(workspaceRoot))
        : undefined;
    return {
        resolve(spec, importerAbsPath) {
            if (!spec.startsWith("./") && !spec.startsWith("../")) {
                throw new Error(
                    `Only relative imports (./, ../) are supported; got: ${spec}`,
                );
            }
            const dir = path.dirname(importerAbsPath);
            const resolved = path.resolve(dir, spec);
            if (root !== undefined) {
                // Follow symlinks before the containment check so a
                // symlink inside the workspace cannot smuggle in a file
                // that lives outside it. We require the file to exist
                // when workspaceRoot is in play; "file not found" is
                // reported below via read().
                let realPath: string;
                try {
                    realPath = fs.realpathSync(resolved);
                } catch {
                    realPath = resolved;
                }
                const rel = path.relative(root, realPath);
                if (rel.startsWith("..") || path.isAbsolute(rel)) {
                    throw new Error(
                        `Import resolves outside workspace root (${root}): ${spec}`,
                    );
                }
            }
            return resolved;
        },
        read(absPath) {
            return fs.readFileSync(absPath, "utf8");
        },
    };
}
