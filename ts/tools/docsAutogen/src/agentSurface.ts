// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Conventional file-name patterns for the four canonical surfaces of
 * a TypeAgent application agent. Docs render them in this order under
 * the `### Agent surface` heading.
 */
export interface AgentSurface {
    /** *Manifest.json (or simply manifest.json). */
    readonly manifestPath: string | null;
    /** *Schema.ts — typed action/activity definitions. */
    readonly schemaPath: string | null;
    /** *Schema.agr — natural-language grammar rules. */
    readonly grammarPath: string | null;
    /** *ActionHandler.ts (or *Handler.ts) — implements instantiate(). */
    readonly handlerPath: string | null;
}

/**
 * True when at least one of the four surfaces was found, i.e. the
 * package is recognisably an application agent.
 */
export function hasAgentSurface(s: AgentSurface): boolean {
    return (
        s.manifestPath !== null ||
        s.schemaPath !== null ||
        s.grammarPath !== null ||
        s.handlerPath !== null
    );
}

/**
 * Inspect a package's `src/` directory looking for the four canonical
 * agent surface files. Returns paths relative to the package root,
 * POSIX-style, with leading `./src/`.
 *
 * Heuristic-only: matches by filename suffix to mirror the existing
 * naming convention in `ts/packages/agents/**`. Packages outside
 * `packages/agents/**` may incidentally match — that is intentional
 * (e.g. an agent host package may carry a manifest); the renderer
 * still gates the section on package location.
 */
export async function detectAgentSurface(
    packageDir: string,
): Promise<AgentSurface> {
    const srcDir = path.join(packageDir, "src");
    let names: string[] = [];
    try {
        names = await fs.readdir(srcDir);
    } catch {
        return {
            manifestPath: null,
            schemaPath: null,
            grammarPath: null,
            handlerPath: null,
        };
    }
    let manifest: string | null = null;
    let schema: string | null = null;
    let grammar: string | null = null;
    let handler: string | null = null;
    for (const name of names.sort()) {
        if (name.endsWith("Manifest.json") || name === "manifest.json") {
            manifest ??= toRel(name);
        } else if (name.endsWith("Schema.ts")) {
            schema ??= toRel(name);
        } else if (name.endsWith("Schema.agr")) {
            grammar ??= toRel(name);
        } else if (
            name.endsWith("ActionHandler.ts") ||
            name.endsWith("Handler.ts")
        ) {
            handler ??= toRel(name);
        }
    }
    return {
        manifestPath: manifest,
        schemaPath: schema,
        grammarPath: grammar,
        handlerPath: handler,
    };
}

function toRel(name: string): string {
    return `./src/${name}`;
}
