// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const tsRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = path.join(
    tsRoot,
    "tools",
    "scripts",
    "code",
    "circularDepsReport.ts",
);

test("circular scan preserves root paths and visits directories with colliding inodes", () => {
    const root = path.join(
        tsRoot,
        "tools",
        "scripts",
        "test",
        `.circular-deps-${process.pid}`,
    );
    function write(relative, content) {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    try {
        for (const directory of [
            "packages/a/src",
            "packages/b/src",
            "packages/a/test",
            "packages/a/dist",
            "packages/a/node_modules/dependency",
        ]) {
            write(
                `${directory}/index.ts`,
                'export const marker = 1;\nexport { helper } from "./helper.js";\n',
            );
            write(
                `${directory}/helper.ts`,
                'import { marker } from "./index.js";\nexport const helper = () => marker;\n',
            );
        }
        write(
            "packages/a/src/ignored.d.ts",
            "export declare const ignored: string;\n",
        );
        write(
            "inode-collisions.mjs",
            'import fs from "node:fs";\nconst lstat = fs.lstatSync;\nfs.lstatSync = (...args) => { const stat = lstat(...args); stat.ino = 1; stat.dev = 1; return stat; };\n',
        );
        function report(extra = []) {
            execFileSync(
                process.execPath,
                [
                    "--import",
                    "tsx",
                    "--import",
                    pathToFileURL(path.join(root, "inode-collisions.mjs")).href,
                    script,
                    "--root",
                    root,
                    "--out-dir",
                    path.join(root, "report"),
                    ...extra,
                ],
                { cwd: tsRoot, encoding: "utf8", timeout: 60_000 },
            );
            return JSON.parse(
                fs.readFileSync(
                    path.join(root, "report", "report.json"),
                    "utf8",
                ),
            );
        }
        const source = report();
        assert.equal(source.totals.files, 4);
        assert.equal(source.totals.cycles, 2);
        assert.deepEqual(source.cycles.map((cycle) => cycle.nodes).sort(), [
            ["packages/a/src/helper.ts", "packages/a/src/index.ts"],
            ["packages/b/src/helper.ts", "packages/b/src/index.ts"],
        ]);
        const includingTests = report(["--include-tests"]);
        assert.equal(includingTests.totals.files, 6);
        assert.equal(includingTests.totals.cycles, 3);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
