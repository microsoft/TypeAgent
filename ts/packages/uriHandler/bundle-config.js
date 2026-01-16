// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
    entryPoints: [join(__dirname, "dist", "index.js")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(__dirname, "bundle", "agent-uri-handler.bundle.js"),
    minify: false,
    sourcemap: true,
    banner: {
        js: `// TypeAgent URI Handler Bundle
// Generated: ${new Date().toISOString()}
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
`,
    },
    logLevel: "info",
    external: [
        "node:*",
        "readline/promises",
        "tty",
        "util",
        "net",
        "fs",
        "path",
        "os",
        "crypto",
        "stream",
        "http",
        "https",
        "zlib",
        "buffer",
    ],
};

try {
    await esbuild.build(config);
    console.log("\n✓ Bundle created successfully");
    console.log(`\nBundle location: ${config.outfile}`);
} catch (error) {
    console.error("\n✗ Bundle failed:", error);
    process.exit(1);
}
