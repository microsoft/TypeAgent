// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// REST handler template generator — the fetch-based twin of
// cliHandlerTemplate.ts. Produces a complete TypeScript action handler that
// issues real HTTP requests against a base URL captured from an OpenAPI 3
// spec's `servers[0].url` (see discoveryHandler.ts's parseOpenApiSpec arm).
//
// Called by scaffolderHandler when the API surface has a resolved
// `baseUrl` and HTTP-method actions with a `path` (parseOpenApiSpec arm
// only — crawlDocUrl's LLM-guessed method/path is out of scope).
//
// v1 limitations (see restHandler.template header comment too):
//   - scalar path/query params only (no arrays/objects, no style/explode)
//   - header/cookie params are unsupported: required ones fail the action,
//     optional ones are silently dropped
//   - no auth (no Authorization / api-key headers)
//   - DELETE requests never carry a body
//   - `$ref`-based params/bodies/path-items are skipped upstream in
//     discoveryHandler.ts, so they never reach this generator

import type { DiscoveredAction } from "../discovery/discoveryHandler.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve template from src/ relative to the package root.
// At runtime __dirname is dist/scaffolder/, so go up two levels to package root.
function templatePath(): string {
    return path.resolve(__dirname, "../../src/scaffolder/restHandler.template");
}

const HTTP_METHODS_WITH_HANDLER = new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
]);

// Deterministic wire-name -> camelCase transform. Mirrors the transform
// SchemaGen's LLM prompt asks the model to apply to parameter names
// (schemaGenHandler.ts), so `book_id` / `book-id` on the wire becomes the
// `bookId` the LLM is expected to populate in `action.parameters`. Exotic
// LLM renames outside this transform are a known v1 limitation.
function toCamel(wireName: string): string {
    return wireName.replace(/[-_]+([A-Za-z0-9])/g, (_, c: string) =>
        c.toUpperCase(),
    );
}

// Bracket-access expression reading a parameter by its camelCase runtime
// name, falling back to the original wire name in case the LLM (or a
// simple/no-op transform) preserved it verbatim.
function paramValueExpr(wireName: string): string {
    const camel = toCamel(wireName);
    if (camel === wireName) {
        return `parameters[${JSON.stringify(wireName)}]`;
    }
    return `parameters[${JSON.stringify(camel)}] ?? parameters[${JSON.stringify(wireName)}]`;
}

// Builds a JS expression for the request path: literal segments are
// JSON.stringify'd string literals, `{param}` placeholders become
// `encodeURIComponent(String(<value expr>))`, all joined with `+`. This
// avoids template-literal escaping concerns entirely (no backtick/`${`
// collision risk from spec-provided literal text).
function buildPathExpr(
    pathTemplate: string,
    pathParamNames: Set<string>,
): string {
    const parts: string[] = [];
    let lastIndex = 0;
    const re = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pathTemplate)) !== null) {
        const literal = pathTemplate.slice(lastIndex, m.index);
        if (literal) parts.push(JSON.stringify(literal));
        const paramName = m[1];
        if (pathParamNames.has(paramName)) {
            parts.push(
                `encodeURIComponent(String(${paramValueExpr(paramName)}))`,
            );
        } else {
            // Path placeholder with no captured parameter (shouldn't
            // normally happen for an inline spec) — leave the literal
            // placeholder text in place rather than throw at generation time.
            parts.push(JSON.stringify(m[0]));
        }
        lastIndex = re.lastIndex;
    }
    const tail = pathTemplate.slice(lastIndex);
    if (tail || parts.length === 0) parts.push(JSON.stringify(tail));
    return parts.join(" + ");
}

function buildSwitchCases(actions: DiscoveredAction[]): string {
    const cases: string[] = [];
    for (const action of actions) {
        const method = (action.method ?? "GET").toUpperCase();
        const pathTemplate = action.path ?? "/";
        const pathParamNames = new Set(
            [...pathTemplate.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
        );

        const params = action.parameters ?? [];
        const bodyParams = params.filter((p) => p.in === "body");
        const headerCookieParams = params.filter(
            (p) => p.in === "header" || p.in === "cookie",
        );
        const queryParams = params.filter(
            (p) =>
                p.in === "query" ||
                (p.in === undefined &&
                    !pathParamNames.has(p.name) &&
                    !bodyParams.includes(p)),
        );

        const requiredUnsupported = headerCookieParams.find((p) => p.required);
        if (requiredUnsupported) {
            cases.push(
                `        case ${JSON.stringify(action.name)}:\n` +
                    `            throw new Error(${JSON.stringify(
                        `Required parameter "${requiredUnsupported.name}" (${requiredUnsupported.in}) is not supported by the generated REST handler in v1.`,
                    )});`,
            );
            continue;
        }
        // Optional header/cookie params are silently dropped (v1 limitation).

        const lines: string[] = [];
        lines.push(`        case ${JSON.stringify(action.name)}: {`);
        lines.push(
            `            const path = ${buildPathExpr(pathTemplate, pathParamNames)};`,
        );
        lines.push(`            const query: Record<string, unknown> = {};`);
        for (const p of queryParams) {
            lines.push(
                `            query[${JSON.stringify(p.name)}] = ${paramValueExpr(p.name)};`,
            );
        }
        if (
            ["POST", "PUT", "PATCH"].includes(method) &&
            bodyParams.length > 0
        ) {
            lines.push(`            const body: Record<string, unknown> = {`);
            for (const p of bodyParams) {
                lines.push(
                    `                [${JSON.stringify(p.name)}]: ${paramValueExpr(p.name)},`,
                );
            }
            lines.push(`            };`);
            lines.push(
                `            return await callRest(${JSON.stringify(method)}, path, query, body);`,
            );
        } else {
            lines.push(
                `            return await callRest(${JSON.stringify(method)}, path, query, undefined);`,
            );
        }
        lines.push(`        }`);
        cases.push(lines.join("\n"));
    }
    return cases.join("\n");
}

/**
 * Returns the subset of `actions` this generator can actually handle:
 * actions from the parseOpenApiSpec arm with a recognized HTTP method and a
 * `path`. Used by scaffolderHandler to decide whether to route to the REST
 * generator at all.
 */
/**
 * Returns the subset of `actions` this generator can actually handle:
 * actions from the parseOpenApiSpec arm with a recognized HTTP method and a
 * `path`. Used by scaffolderHandler to decide whether to route to the REST
 * generator at all.
 *
 * Also excludes any action whose path template contains a `{placeholder}`
 * that has no corresponding resolved (non-`$ref`) path parameter — this can
 * happen if a path param used an unsupported `$ref` shape (e.g. an external
 * file reference) that discoveryHandler.ts's local-ref resolution couldn't
 * follow. Emitting a handler for such an action would substitute the
 * literal string "undefined" into the request URL at runtime; safer to
 * fall back to the stub handler for that action than to silently build a
 * broken request.
 */
export function filterRestActions(
    actions: DiscoveredAction[] | undefined,
): DiscoveredAction[] {
    if (!actions) return [];
    return actions.filter((a) => {
        if (
            !a.path ||
            !a.method ||
            !HTTP_METHODS_WITH_HANDLER.has(a.method.toUpperCase())
        ) {
            return false;
        }
        const pathParamNames = new Set(
            [...a.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
        );
        if (pathParamNames.size === 0) return true;
        const resolvedPathParamNames = new Set(
            (a.parameters ?? [])
                .filter((p) => p.in === "path")
                .map((p) => p.name),
        );
        for (const placeholder of pathParamNames) {
            if (!resolvedPathParamNames.has(placeholder)) return false;
        }
        return true;
    });
}

export async function buildRestHandler(
    name: string,
    pascalName: string,
    baseUrl: string,
    actions: DiscoveredAction[],
): Promise<string> {
    const tpl = await fs.readFile(templatePath(), "utf-8");
    const switchCases = buildSwitchCases(actions);
    // Use function-form replacers: string-form replace treats "$"
    // sequences in the replacement as special (e.g. "$&", "$1"), which a
    // generated base URL or switch-case body could plausibly contain.
    return tpl
        .replace(/\{\{NAME\}\}/g, () => name)
        .replace(/\{\{PASCAL_NAME\}\}/g, () => pascalName)
        .replace(/\{\{BASE_URL\}\}/g, () => JSON.stringify(baseUrl))
        .replace(/\{\{SWITCH_CASES\}\}/g, () => switchCases);
}
