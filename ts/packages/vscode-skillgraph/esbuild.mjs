// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

// dist/
//   extension.cjs   VS Code client (vscode-languageclient)
//   skillgraph.mjs  CLI + LSP server, one file (`node skillgraph.mjs lsp`)
//   *.wasm          tree-sitter runtime + grammars, loaded beside the bundle

const OUT = "dist";
const WASM = [
    "web-tree-sitter/web-tree-sitter.wasm",
    "tree-sitter-bash/tree-sitter-bash.wasm",
    "tree-sitter-powershell/tree-sitter-powershell.wasm",
    "tree-sitter-python/tree-sitter-python.wasm",
    "tree-sitter-javascript/tree-sitter-javascript.wasm",
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
];

const common = {
    bundle: true,
    platform: "node",
    target: "node20",
    minify: true,
};

await esbuild.build({
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: `${OUT}/extension.cjs`,
    external: ["vscode"],
    format: "cjs",
});

// skillgraph resolves grammar packages from its own node_modules.
const skillgraph = fs.realpathSync("node_modules/@typeagent/skillgraph");
const fromSkillgraph = createRequire(path.join(skillgraph, "package.json"));
await esbuild.build({
    ...common,
    entryPoints: [path.join(skillgraph, "bin/skillgraph.js")],
    outfile: `${OUT}/skillgraph.mjs`,
    format: "esm",
    // CJS deps (vscode-languageserver) call require() inside an ESM bundle.
    banner: {
        js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    },
});
for (const file of WASM) {
    fs.copyFileSync(
        fromSkillgraph.resolve(file),
        path.join(OUT, path.basename(file)),
    );
}
console.log("Build complete");
