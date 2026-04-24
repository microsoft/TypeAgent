// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// predicateEvaluator.ts - Runtime evaluation of predicates
//
// Evaluates the subset of predicates that can be checked at runtime:
//   - File predicates (file_exists, is_file, is_directory, etc.)
//   - Content predicates (file_contains, file_matches, file_has_line, etc.)
//   - Logical combinators (and, or, not, implies, iff)
//   - State predicates (binding_defined, step_completed)
//   - Literal predicates (true, false)
//
// NOT evaluated (returns 'unsupported'):
//   - Semantic predicates (function_exists, class_extends, valid_syntax)
//   - Quantifiers (forAll, exists, unique) — need ValueExpr evaluation
//   - Temporal predicates (before, after, always, eventually)
//   - Comparison predicates — need full ValueExpr evaluation
//   - State predicates requiring diff tracking (changed, unchanged, etc.)
// ═══════════════════════════════════════════════════════════════════════════

import {
    existsSync,
    readFileSync,
    statSync,
    accessSync,
    constants,
} from "node:fs";
import { dirname, basename, extname } from "node:path";
import type { Predicate, PathExpr, CompareOp } from "./specSchema.js";

// ───────────────────────────────────────────────────────────────────────────
// EVALUATION CONTEXT
// ───────────────────────────────────────────────────────────────────────────

export interface EvalContext {
    /** Runtime bindings (step outputs) */
    bindings: Map<string, unknown>;

    /** Step outputs keyed by step index */
    stepOutputs?: Map<number, unknown>;

    /** Set of completed step indices */
    completedSteps: Set<number>;

    /** Set of failed step indices */
    failedSteps?: Set<number>;
}

// ───────────────────────────────────────────────────────────────────────────
// EVALUATION RESULT
// ───────────────────────────────────────────────────────────────────────────

export type PredicateResult =
    | { status: "pass" }
    | { status: "fail"; message: string }
    | { status: "unsupported"; message: string }
    | { status: "error"; message: string };

export interface PostconditionResult {
    allPassed: boolean;
    results: { index: number; predicate: Predicate; result: PredicateResult }[];
}

// ───────────────────────────────────────────────────────────────────────────
// POSTCONDITION EVALUATOR
// ───────────────────────────────────────────────────────────────────────────

/**
 * Evaluates an array of postcondition predicates.
 * Returns detailed results for each predicate.
 *
 * Unsupported predicates are reported but don't cause failure —
 * only predicates that evaluate to 'fail' count.
 */
export function evaluatePostconditions(
    predicates: Predicate[],
    ctx: EvalContext,
): PostconditionResult {
    const results: PostconditionResult["results"] = [];
    let allPassed = true;

    for (let i = 0; i < predicates.length; i++) {
        const result = evaluatePredicate(predicates[i], ctx);
        results.push({ index: i, predicate: predicates[i], result });
        if (result.status === "fail") {
            allPassed = false;
        }
    }

    return { allPassed, results };
}

// ───────────────────────────────────────────────────────────────────────────
// PREDICATE EVALUATOR
// ───────────────────────────────────────────────────────────────────────────

export function evaluatePredicate(
    pred: Predicate,
    ctx: EvalContext,
): PredicateResult {
    try {
        return evaluatePredicateInner(pred, ctx);
    } catch (err: any) {
        return { status: "error", message: err.message };
    }
}

function evaluatePredicateInner(
    pred: Predicate,
    ctx: EvalContext,
): PredicateResult {
    switch (pred.type) {
        // ─── Literal ────────────────────────────────────────────────
        case "true":
            return { status: "pass" };
        case "false":
            return { status: "fail", message: "Predicate is literally false" };

        // ─── File predicates ────────────────────────────────────────
        case "file_exists": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            return existsSync(p)
                ? { status: "pass" }
                : { status: "fail", message: `File does not exist: ${p}` };
        }
        case "file_not_exists": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            return !existsSync(p)
                ? { status: "pass" }
                : {
                      status: "fail",
                      message: `File exists but should not: ${p}`,
                  };
        }
        case "is_file": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                return statSync(p).isFile()
                    ? { status: "pass" }
                    : { status: "fail", message: `Not a file: ${p}` };
            } catch {
                return { status: "fail", message: `Cannot stat: ${p}` };
            }
        }
        case "is_directory": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                return statSync(p).isDirectory()
                    ? { status: "pass" }
                    : { status: "fail", message: `Not a directory: ${p}` };
            } catch {
                return { status: "fail", message: `Cannot stat: ${p}` };
            }
        }
        case "is_empty_file": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const size = statSync(p).size;
                return size === 0
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File is not empty (${size} bytes): ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot stat: ${p}` };
            }
        }
        case "is_readable": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                accessSync(p, constants.R_OK);
                return { status: "pass" };
            } catch {
                return {
                    status: "fail",
                    message: `File is not readable: ${p}`,
                };
            }
        }
        case "is_writable": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                accessSync(p, constants.W_OK);
                return { status: "pass" };
            } catch {
                return {
                    status: "fail",
                    message: `File is not writable: ${p}`,
                };
            }
        }
        case "file_size": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const size = statSync(p).size;
                return compareOp(size, pred.op, pred.bytes)
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File size ${size} does not satisfy ${pred.op} ${pred.bytes}: ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot stat: ${p}` };
            }
        }

        // ─── Content predicates ─────────────────────────────────────
        case "file_contains": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                let content = readFileSync(p, "utf-8");
                let search = pred.text;
                if (pred.caseSensitive === false) {
                    content = content.toLowerCase();
                    search = search.toLowerCase();
                }
                return content.includes(search)
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File does not contain '${pred.text}': ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot read: ${p}` };
            }
        }
        case "file_not_contains": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const content = readFileSync(p, "utf-8");
                return !content.includes(pred.text)
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File contains '${pred.text}' but should not: ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot read: ${p}` };
            }
        }
        case "file_matches": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const content = readFileSync(p, "utf-8");
                const regex = new RegExp(pred.regex, pred.flags);
                return regex.test(content)
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File does not match /${pred.regex}/${pred.flags ?? ""}: ${p}`,
                      };
            } catch (err: any) {
                return {
                    status: "error",
                    message: `Regex error or cannot read: ${err.message}`,
                };
            }
        }
        case "file_has_line": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const lines = readFileSync(p, "utf-8").split("\n");
                if (pred.lineNumber !== undefined) {
                    const idx = pred.lineNumber - 1; // 1-based to 0-based
                    return idx >= 0 &&
                        idx < lines.length &&
                        lines[idx].trim() === pred.line.trim()
                        ? { status: "pass" }
                        : {
                              status: "fail",
                              message: `Line ${pred.lineNumber} does not match '${pred.line}': ${p}`,
                          };
                }
                return lines.some((l) => l.trim() === pred.line.trim())
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File does not contain line '${pred.line}': ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot read: ${p}` };
            }
        }
        case "file_has_lines": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const content = readFileSync(p, "utf-8");
                const fileLines = content.split("\n").map((l) => l.trim());
                const searchLines = pred.lines.map((l) => l.trim());

                if (pred.ordered) {
                    let searchIdx = 0;
                    for (
                        let i = 0;
                        i < fileLines.length && searchIdx < searchLines.length;
                        i++
                    ) {
                        if (fileLines[i] === searchLines[searchIdx]) {
                            searchIdx++;
                        }
                    }
                    return searchIdx === searchLines.length
                        ? { status: "pass" }
                        : {
                              status: "fail",
                              message: `File does not contain all lines in order: ${p}`,
                          };
                }
                const allFound = searchLines.every((sl) =>
                    fileLines.includes(sl),
                );
                return allFound
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File is missing some expected lines: ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot read: ${p}` };
            }
        }
        case "line_count": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const count = readFileSync(p, "utf-8").split("\n").length;
                return compareOp(count, pred.op, pred.value)
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `Line count ${count} does not satisfy ${pred.op} ${pred.value}: ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot read: ${p}` };
            }
        }
        case "file_starts_with": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const content = readFileSync(p, "utf-8");
                return content.startsWith(pred.text)
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File does not start with '${pred.text.slice(0, 50)}': ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot read: ${p}` };
            }
        }
        case "file_ends_with": {
            const p = resolvePath(pred.path, ctx);
            if (p === null)
                return {
                    status: "unsupported",
                    message: "Cannot resolve path expression",
                };
            try {
                const content = readFileSync(p, "utf-8");
                return content.endsWith(pred.text)
                    ? { status: "pass" }
                    : {
                          status: "fail",
                          message: `File does not end with '${pred.text.slice(0, 50)}': ${p}`,
                      };
            } catch {
                return { status: "fail", message: `Cannot read: ${p}` };
            }
        }

        // ─── State predicates ───────────────────────────────────────
        case "binding_defined":
            return ctx.bindings.has(pred.name)
                ? { status: "pass" }
                : {
                      status: "fail",
                      message: `Binding '${pred.name}' is not defined`,
                  };

        case "step_completed":
            return ctx.completedSteps.has(pred.stepIndex)
                ? { status: "pass" }
                : {
                      status: "fail",
                      message: `Step ${pred.stepIndex} has not completed`,
                  };

        case "step_failed":
            return ctx.failedSteps?.has(pred.stepIndex)
                ? { status: "pass" }
                : {
                      status: "fail",
                      message: `Step ${pred.stepIndex} has not failed`,
                  };

        // changed/unchanged/created_during_execution/deleted_during_execution
        // require before/after snapshots we don't track yet
        case "changed":
        case "unchanged":
        case "created_during_execution":
        case "deleted_during_execution":
            return {
                status: "unsupported",
                message: `State predicate '${pred.type}' requires diff tracking`,
            };

        // ─── Logical combinators ────────────────────────────────────
        case "and": {
            for (const p of pred.predicates) {
                const r = evaluatePredicate(p, ctx);
                if (r.status === "fail") return r;
                if (r.status === "error") return r;
            }
            return { status: "pass" };
        }
        case "or": {
            const failures: string[] = [];
            for (const p of pred.predicates) {
                const r = evaluatePredicate(p, ctx);
                if (r.status === "pass") return { status: "pass" };
                if (r.status === "fail") failures.push(r.message);
            }
            return {
                status: "fail",
                message: `No OR branch passed: ${failures.join("; ")}`,
            };
        }
        case "not": {
            const r = evaluatePredicate(pred.predicate, ctx);
            if (r.status === "pass")
                return {
                    status: "fail",
                    message: "NOT predicate was satisfied (expected failure)",
                };
            if (r.status === "fail") return { status: "pass" };
            return r; // propagate unsupported/error
        }
        case "implies": {
            const ifResult = evaluatePredicate(pred.if, ctx);
            if (ifResult.status === "fail") return { status: "pass" }; // false → anything is true
            if (ifResult.status !== "pass") return ifResult;
            return evaluatePredicate(pred.then, ctx);
        }
        case "iff": {
            const leftResult = evaluatePredicate(pred.left, ctx);
            const rightResult = evaluatePredicate(pred.right, ctx);
            if (
                leftResult.status === "unsupported" ||
                rightResult.status === "unsupported"
            ) {
                return {
                    status: "unsupported",
                    message: "Cannot evaluate iff with unsupported operands",
                };
            }
            const leftPass = leftResult.status === "pass";
            const rightPass = rightResult.status === "pass";
            return leftPass === rightPass
                ? { status: "pass" }
                : {
                      status: "fail",
                      message:
                          "Biconditional failed: sides have different truth values",
                  };
        }

        // ─── Unsupported categories ─────────────────────────────────
        case "forAll":
        case "exists":
        case "unique":
            return {
                status: "unsupported",
                message: `Quantifier '${pred.type}' requires ValueExpr evaluation`,
            };

        case "before":
        case "after":
        case "always":
        case "eventually":
            return {
                status: "unsupported",
                message: `Temporal predicate '${pred.type}' is not evaluated at runtime`,
            };

        case "equals":
        case "not_equals":
        case "greater_than":
        case "greater_than_or_equal":
        case "less_than":
        case "less_than_or_equal":
        case "in_range":
            return {
                status: "unsupported",
                message: `Comparison predicate '${pred.type}' requires ValueExpr evaluation`,
            };

        case "function_exists":
        case "function_has_params":
        case "function_returns_type":
        case "class_exists":
        case "class_extends":
        case "class_has_method":
        case "imports":
        case "exports":
        case "valid_syntax":
        case "no_lint_errors":
            return {
                status: "unsupported",
                message: `Semantic predicate '${pred.type}' requires AST analysis`,
            };

        default:
            return {
                status: "unsupported",
                message: `Unknown predicate type: ${(pred as any).type}`,
            };
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PATH RESOLUTION
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolves a PathExpr to a concrete string path.
 * Returns null for expressions that can't be resolved (vars without bindings, etc.).
 */
export function resolvePath(expr: PathExpr, ctx: EvalContext): string | null {
    switch (expr.type) {
        case "literal":
            return expr.value;

        case "var": {
            const val = ctx.bindings.get(expr.name);
            return typeof val === "string" ? val : null;
        }

        case "join": {
            const parts: string[] = [];
            for (const part of expr.parts) {
                const resolved = resolvePath(part, ctx);
                if (resolved === null) return null;
                parts.push(resolved);
            }
            return parts.join(expr.separator ?? "/");
        }

        case "parent": {
            const p = resolvePath(expr.path, ctx);
            return p !== null ? dirname(p) : null;
        }

        case "basename": {
            const p = resolvePath(expr.path, ctx);
            return p !== null ? basename(p) : null;
        }

        case "extension": {
            const p = resolvePath(expr.path, ctx);
            return p !== null ? extname(p) : null;
        }

        case "stepOutput": {
            const output = ctx.stepOutputs?.get(expr.stepIndex);
            if (output === undefined) return null;
            if (typeof output === "string") return output;
            if (typeof output === "object" && output !== null) {
                const val = (output as Record<string, unknown>)[expr.field];
                return typeof val === "string" ? val : null;
            }
            return null;
        }

        case "template":
            // Template resolution requires full ValueExpr evaluation
            return null;

        default:
            return null;
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PLAN PERMISSIONS ENFORCEMENT
// ───────────────────────────────────────────────────────────────────────────

export interface PermissionCheckResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Checks a file path against the plan's own declared permissions.
 * Uses glob matching — same logic as org policy path checks.
 */
export function checkPlanPermission(
    filePath: string,
    operation: "read" | "write",
    allowedReadPaths: string[],
    allowedWritePaths: string[],
    deniedPaths: string[],
): PermissionCheckResult {
    const normalized = filePath.replace(/\\/g, "/");

    // Denied paths always win
    for (const pattern of deniedPaths) {
        if (globMatch(normalized, pattern)) {
            return {
                allowed: false,
                reason: `Path '${filePath}' matches denied pattern '${pattern}'`,
            };
        }
    }

    // Check allowed paths
    const allowedPatterns =
        operation === "read" ? allowedReadPaths : allowedWritePaths;
    if (allowedPatterns.length > 0) {
        const allowed = allowedPatterns.some((pattern) =>
            globMatch(normalized, pattern),
        );
        if (!allowed) {
            return {
                allowed: false,
                reason: `Path '${filePath}' is not within allowed ${operation} paths`,
            };
        }
    }

    return { allowed: true };
}

/**
 * Simple glob matching (same as orgPolicy.ts).
 */
function globMatch(path: string, pattern: string): boolean {
    const normalizedPattern = pattern.replace(/\\/g, "/");
    const regexStr = normalizedPattern
        .replace(/[\\.+^${}()|[\]]/g, "\\$&")
        .replace(/\*\*/g, "{{DOUBLESTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/{{DOUBLESTAR}}/g, ".*")
        .replace(/\?/g, "[^/]");
    return new RegExp(`^${regexStr}$`).test(path);
}

// ───────────────────────────────────────────────────────────────────────────
// UTILITY
// ───────────────────────────────────────────────────────────────────────────

function compareOp(a: number, op: CompareOp, b: number): boolean {
    switch (op) {
        case "eq":
            return a === b;
        case "neq":
            return a !== b;
        case "gt":
            return a > b;
        case "gte":
            return a >= b;
        case "lt":
            return a < b;
        case "lte":
            return a <= b;
        default:
            return false;
    }
}
