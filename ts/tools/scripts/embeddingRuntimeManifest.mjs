// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
    embeddingRuntimeVersions,
    localEmbeddingModels,
} from "./localEmbeddingModels.mjs";

export function writeEmbeddingRuntimeManifest(root) {
    const packages = {};
    const visited = new Set();
    function visit(directory) {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, {
            withFileTypes: true,
        })) {
            if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
            const target = path.join(directory, entry.name);
            if (entry.name.startsWith("@")) {
                visit(target);
                continue;
            }
            const manifest = path.join(target, "package.json");
            if (!fs.existsSync(manifest)) continue;
            const real = fs.realpathSync(target);
            if (visited.has(real)) continue;
            visited.add(real);
            const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
            const expected = embeddingRuntimeVersions[pkg.name];
            if (expected) {
                if (pkg.version !== expected) {
                    throw new Error(
                        `Embedding runtime requires ${pkg.name}@${expected}; artifact contains ${pkg.version}.`,
                    );
                }
                (packages[pkg.name] ??= []).push(path.relative(root, target));
            }
            visit(path.join(target, "node_modules"));
        }
    }
    visit(path.join(root, "node_modules"));
    for (const name of Object.keys(embeddingRuntimeVersions)) {
        if (!packages[name]?.length)
            throw new Error(`Embedding runtime package missing: ${name}`);
    }
    const require = createRequire(path.join(root, "package.json"));
    for (const name of Object.keys(embeddingRuntimeVersions))
        require.resolve(name);
    const manifest = {
        versions: embeddingRuntimeVersions,
        packages,
        device: "cpu",
        dtype: "fp32",
        defaultModel: "minilm",
        models: localEmbeddingModels,
        downloadRequiresConsent: true,
        restartRequiredToSwitch: true,
    };
    fs.writeFileSync(
        path.join(root, "embedding-runtime.json"),
        JSON.stringify(manifest, null, 2) + "\n",
    );
    return manifest;
}
