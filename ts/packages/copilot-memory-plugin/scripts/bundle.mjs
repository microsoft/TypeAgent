#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Bundle hook and MCP entry points so Copilot can copy the plugin without
 * following pnpm symlinks. Native addons stay external; ConversationMemory's
 * chat path does not load them unless SQLite storage is requested.
 */

import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const optionalNatives = [
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
    "canvas",
    "keytar",
];

await build({
    entryPoints: {
        "hooks/hook-router": resolve(pluginRoot, "src/hooks/hook-router.ts"),
        "hooks/stop-router": resolve(pluginRoot, "src/hooks/stop-router.ts"),
        "mcp/server": resolve(pluginRoot, "src/mcp/server.ts"),
    },
    outdir: resolve(pluginRoot, "dist/bundle"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    external: ["bufferutil", "utf-8-validate"],
    plugins: [
        {
            name: "optional-native",
            setup(build) {
                const filter = new RegExp(
                    `^(?:${optionalNatives
                        .map((name) =>
                            name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                        )
                        .join("|")})$`,
                );
                build.onResolve({ filter }, (args) => ({
                    path: args.path,
                    namespace: "optional-native",
                }));
                build.onLoad(
                    { filter: /.*/, namespace: "optional-native" },
                    (args) => ({
                        contents:
                            `const missing = ${JSON.stringify(args.path)};\n` +
                            "const fail = () => {\n" +
                            '    throw new Error(missing + " is not available in this plugin bundle");\n' +
                            "};\n" +
                            "export default fail;\n" +
                            "export const create = fail;\n",
                        loader: "js",
                    }),
                );
            },
        },
    ],
    banner: {
        js: [
            "import { createRequire as __cr } from 'module';",
            "import { fileURLToPath as __fileURLToPath } from 'node:url';",
            "import { dirname as __pathDirname } from 'node:path';",
            "const require = __cr(import.meta.url);",
            "const __filename = __fileURLToPath(import.meta.url);",
            "const __dirname = __pathDirname(__filename);",
        ].join("\n"),
    },
    logLevel: "warning",
});

process.stdout.write(
    "[copilot-memory-plugin] Bundled entry points into dist.\n",
);
