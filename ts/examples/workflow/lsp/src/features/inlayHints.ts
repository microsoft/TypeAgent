// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { InlayHint, InlayHintKind, Range } from "vscode-languageserver/node.js";
import type { Expr, Statement } from "workflow-dsl";
import { TypeChecker, formatType } from "workflow-dsl";
import { getParsed } from "../parsedDocument.js";
import type { TaskSchema } from "../taskSchemas.js";

/**
 * Inlay hints for the workflow DSL.
 *
 * Emits `: <type>` hints for:
 *   - `const x = <expr>` bindings that lack an explicit type annotation
 *   - lambda parameters in map/filter/parallelMap/attempts-fallback
 *     (e.g. `(repo) =>` gets `: string` after `repo`)
 *
 * Types are resolved via the type checker so object types expand fully
 * (e.g. `{ stdout: string; stderr: string; exitCode: integer }`).
 */

/** Yields every expression-level lambda node reachable from `stmts`. */
interface LambdaParam {
    /** Name of the parameter. */
    name: string;
    /** Source offset of the first character of the param token. */
    offset: number;
    /** Offset used as key in collectSymbolTypes (same as paramLoc.offset). */
    defOffset: number;
}

function* iterLambdaParams(stmts: Statement[]): IterableIterator<LambdaParam> {
    for (const s of stmts) {
        // Collect lambda params from any expression in this statement.
        const exprs: Expr[] = [];
        if (s.kind === "ConstStatement" || s.kind === "ReturnStatement") {
            exprs.push(s.value);
        } else if (s.kind === "IfStatement") {
            exprs.push(s.condition);
            yield* iterLambdaParams(s.then);
            if (s.else_) yield* iterLambdaParams(s.else_);
        } else if (s.kind === "SwitchStatement") {
            exprs.push(s.discriminant);
            for (const arm of s.arms) yield* iterLambdaParams(arm.body);
            if (s.default_) yield* iterLambdaParams(s.default_);
        }

        for (const e of exprs) {
            if (
                (e.kind === "MapNode" ||
                    e.kind === "FilterNode" ||
                    e.kind === "ParallelMapNode") &&
                e.paramLoc
            ) {
                yield {
                    name: e.param,
                    offset: e.paramLoc.offset,
                    defOffset: e.paramLoc.offset,
                };
                yield* iterLambdaParams(e.body);
            } else if (e.kind === "AttemptsNode") {
                yield* iterLambdaParams(e.body);
                if (e.fallback?.param && e.fallback.paramLoc) {
                    yield {
                        name: e.fallback.param,
                        offset: e.fallback.paramLoc.offset,
                        defOffset: e.fallback.paramLoc.offset,
                    };
                    yield* iterLambdaParams(e.fallback.body);
                }
            }
        }
    }
}

function* iterStatements(stmts: Statement[]): IterableIterator<Statement> {
    for (const s of stmts) {
        yield s;
        switch (s.kind) {
            case "IfStatement":
                yield* iterStatements(s.then);
                if (s.else_) yield* iterStatements(s.else_);
                break;
            case "SwitchStatement":
                for (const c of s.arms) yield* iterStatements(c.body);
                if (s.default_) yield* iterStatements(s.default_);
                break;
        }
    }
}

export function computeInlayHints(
    doc: TextDocument,
    schemas: TaskSchema[],
    range?: Range,
): InlayHint[] {
    const parsed = getParsed(doc);
    if (parsed.workflows.length === 0) return [];
    const text = doc.getText();
    const hints: InlayHint[] = [];
    const rangeStartOffset = range ? doc.offsetAt(range.start) : 0;
    const rangeEndOffset = range ? doc.offsetAt(range.end) : text.length;

    // Single multi-workflow pass: one merged Map<offset, TypeInfo>
    // keyed by file-wide unique source offset.
    const decls = parsed.workflows.map((w) => w.decl);
    const symbolTypes = new TypeChecker(schemas).collectSymbolTypes(decls);

    for (const ast of decls) {
        // ---- const bindings ----
        for (const stmt of iterStatements(ast.body)) {
            if (stmt.kind !== "ConstStatement" || stmt.isSynthetic) continue;
            if (stmt.loc.offset < rangeStartOffset) continue;
            if (stmt.loc.offset >= rangeEndOffset) continue;

            const typeInfo = symbolTypes.get(stmt.nameLoc.offset);
            if (!typeInfo || typeInfo.kind === "unresolved") continue;

            // Find the binding name end offset: `const <name> [: T] [= ...]`.
            let nameStart = stmt.loc.offset;
            if (text.startsWith("const", nameStart)) nameStart += 5;
            while (nameStart < text.length && /\s/.test(text[nameStart]!))
                nameStart++;
            if (!text.startsWith(stmt.name, nameStart)) continue;
            const nameEnd = nameStart + stmt.name.length;
            // Skip if the source already has a `:` after the name (typed const).
            let probe = nameEnd;
            while (probe < text.length && /\s/.test(text[probe]!)) probe++;
            if (text[probe] === ":") continue;

            hints.push({
                position: doc.positionAt(nameEnd),
                label: `: ${formatType(typeInfo)}`,
                kind: InlayHintKind.Type,
                paddingLeft: false,
                paddingRight: true,
            });
        }

        // ---- lambda parameters ----
        for (const lp of iterLambdaParams(ast.body)) {
            if (lp.offset < rangeStartOffset || lp.offset >= rangeEndOffset)
                continue;
            const typeInfo = symbolTypes.get(lp.defOffset);
            if (!typeInfo || typeInfo.kind === "unresolved") continue;

            hints.push({
                position: doc.positionAt(lp.offset + lp.name.length),
                label: `: ${formatType(typeInfo)}`,
                kind: InlayHintKind.Type,
                paddingLeft: false,
                paddingRight: false,
            });
        }
    }

    return hints;
}
