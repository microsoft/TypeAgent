// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Post-tsc step for @typeagent/core.
//
// @typeagent/core depends on two packages that are NOT published to the feed:
//   - agent-cache        (packages/cache)
//   - grammar-tools-core (packages/grammarTools/core)
// To keep @typeagent/core installable from the feed without publishing those
// two libs, we inline (bundle) ONLY their code into the compiled dist files
// that import them. Every other import — relative sibling modules, node
// builtins, and all other (published) bare packages — is kept external, so the
// module graph and singletons of @typeagent/core itself are untouched and the
// inlined code's own dependencies resolve normally from the feed.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DIST = path.join(PKG_ROOT, "dist");

// The only packages we inline. Everything else stays external.
const INLINE = new Set(["agent-cache", "grammar-tools-core"]);
const isInlined = (spec) =>
    INLINE.has(spec) || [...INLINE].some((p) => spec.startsWith(p + "/"));

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith(".js")) out.push(full);
    }
    return out;
}

// dist files that still carry a runtime import of an inlined package.
const specRe =
    /(?:from|import|require)\s*\(?\s*["'](agent-cache|grammar-tools-core)(?:\/[^"']*)?["']/;
const entries = walk(DIST).filter((f) =>
    specRe.test(fs.readFileSync(f, "utf8")),
);

if (entries.length === 0) {
    console.warn("[bundle:private] nothing to inline.");
    process.exit(0);
}

// Keep core's OWN relative imports and all published bare packages external;
// bundle only the two inlined packages AND their internal relative modules.
const distPrefix = DIST.toLowerCase();
const keepRelativeAndPublishedExternal = {
    name: "external-except-private",
    setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") return null;
            const spec = args.path;
            const isRelative = spec.startsWith(".") || path.isAbsolute(spec);
            if (isRelative) {
                // Relative import inside core's own dist -> keep external so
                // core's module graph/singletons stay intact. Relative import
                // inside an inlined dep -> follow it (bundle).
                const importerInCore = path
                    .resolve(args.importer)
                    .toLowerCase()
                    .startsWith(distPrefix);
                return importerInCore ? { path: spec, external: true } : null;
            }
            // Bare specifier: bundle the two inlined packages, keep the rest
            // (node builtins + published packages) external.
            if (isInlined(spec)) return null;
            return { path: spec, external: true };
        });
    },
};

for (const entry of entries) {
    await build({
        entryPoints: [entry],
        outfile: entry,
        allowOverwrite: true,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        legalComments: "none",
        logLevel: "warning",
        plugins: [keepRelativeAndPublishedExternal],
    });
    console.warn(
        `[bundle:private] inlined -> ${path.relative(PKG_ROOT, entry)}`,
    );
}

console.warn(`[bundle:private] done (${entries.length} file(s)).`);
