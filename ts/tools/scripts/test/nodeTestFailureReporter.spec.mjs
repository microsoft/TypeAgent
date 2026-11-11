// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { readWorkspace } from "../ciWorkspaceLanes.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const reporter = fileURLToPath(
    new URL("../nodeTestFailureReporter.mjs", import.meta.url),
);
const runner = fileURLToPath(
    new URL("../runTestLocalWithSummary.mjs", import.meta.url),
);
const packageManager = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
).packageManager;
const childEnvironment = { ...process.env };
delete childEnvironment.NODE_TEST_CONTEXT;

test("every workspace Node-test package retains spec output and structured failure reporting", () => {
    const packages = readWorkspace(root).filter((pkg) =>
        /(?:^|&&\s*)(?:node|tsx)\s+--test(?:\s|$)/.test(
            pkg.scripts["test:local"] ?? "",
        ),
    );
    assert.ok(packages.length >= 6);
    for (const pkg of packages) {
        const command = pkg.scripts["test:local"];
        assert.match(command, /--test-reporter=spec/, pkg.name);
        const match = command.match(
            /--test-reporter=([^\s]*nodeTestFailureReporter\.mjs)/,
        );
        assert.ok(
            match,
            `${pkg.name} must report failures to the workspace retry harness`,
        );
        assert.equal(
            fs.realpathSync(path.resolve(root, pkg.directory, match[1])),
            fs.realpathSync(reporter),
        );
        assert.equal(
            (command.match(/--test-reporter-destination=stdout/g) ?? []).length,
            2,
            pkg.name,
        );
    }
});

for (const scenario of ["assertion", "module-crash", "passing"]) {
    test(`real Node reporter captures ${scenario} with the existing failure schema`, (t) => {
        const directory = fs.mkdtempSync(
            path.join(path.dirname(runner), "test", ".node-reporting-"),
        );
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const file = path.join(directory, "example.spec.mjs");
        fs.writeFileSync(
            file,
            scenario === "module-crash"
                ? "throw new Error('module startup failed');"
                : `import test from 'node:test';import assert from 'node:assert/strict';test('synthetic node case',()=>assert.equal(1,${scenario === "passing" ? 1 : 2}));`,
        );
        const output = path.join(directory, "failures");
        const result = spawnSync(
            process.execPath,
            [
                "--test",
                "--test-reporter=spec",
                "--test-reporter-destination=stdout",
                `--test-reporter=${pathToFileURL(reporter).href}`,
                "--test-reporter-destination=stdout",
                file,
            ],
            {
                encoding: "utf8",
                env: {
                    ...childEnvironment,
                    TYPEAGENT_TEST_FAILURES_DIR: output,
                },
            },
        );
        assert.ifError(result.error);
        assert.equal(
            result.status,
            scenario === "passing" ? 0 : 1,
            result.stderr,
        );
        if (scenario === "passing") {
            assert.equal(fs.existsSync(output), false);
        } else {
            const failures = fs
                .readdirSync(output)
                .flatMap((name) =>
                    JSON.parse(
                        fs.readFileSync(path.join(output, name), "utf8"),
                    ),
                );
            assert.equal(failures.length, 1);
            assert.equal(
                fs.realpathSync(failures[0].testFilePath),
                fs.realpathSync(file),
            );
            assert.ok(failures[0].fullName.length > 0);
            assert.ok(failures[0].failureMessages.join("").length > 0);
            if (scenario === "module-crash")
                assert.match(
                    failures[0].failureMessages.join(""),
                    /module startup failed/,
                );
        }
    });
}

for (const permanent of [false, true]) {
    test(`real Node failures reach whole-package retries, permanent=${permanent}`, (t) => {
        const directory = fs.mkdtempSync(
            path.join(path.dirname(runner), "test", ".node-retry-"),
        );
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const packageDir = path.join(directory, "packages", "example");
        fs.mkdirSync(path.join(packageDir, "test"), { recursive: true });
        fs.writeFileSync(
            path.join(directory, "pnpm-workspace.yaml"),
            "packages:\n  - packages/*\n",
        );
        fs.writeFileSync(
            path.join(directory, "package.json"),
            JSON.stringify({
                name: "node-retry-fixture-root",
                private: true,
                packageManager,
                scripts: {
                    "test:local:packages":
                        "pnpm --filter=node-retry-fixture run test:local",
                    "test:local:scripts": "node root-phase.mjs",
                },
            }),
        );
        fs.writeFileSync(
            path.join(packageDir, "package.json"),
            JSON.stringify({
                name: "node-retry-fixture",
                private: true,
                type: "module",
                scripts: {
                    "test:local": `node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=${pathToFileURL(reporter).href} --test-reporter-destination=stdout ${path.join("test", "example.spec.mjs")}`,
                },
            }),
        );
        fs.writeFileSync(
            path.join(directory, "root-phase.mjs"),
            "import fs from 'node:fs'; fs.writeFileSync('root-ran','yes');",
        );
        fs.writeFileSync(
            path.join(packageDir, "test", "example.spec.mjs"),
            `
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const file = new URL('../attempts', import.meta.url);
const attempt = fs.existsSync(file) ? Number(fs.readFileSync(file,'utf8'))+1 : 1;
fs.writeFileSync(file,String(attempt));
test('real failing Node test',()=>assert.ok(${permanent ? "false" : "attempt > 1"}));
`,
        );
        const result = spawnSync(process.execPath, [runner], {
            cwd: directory,
            encoding: "utf8",
            timeout: 90000,
            env: {
                ...childEnvironment,
                TYPEAGENT_TEST_PHASE: "all",
                TYPEAGENT_TEST_WORKSPACE_TIMEOUT_MS: "60000",
                pnpm_config_verify_deps_before_run: "false",
            },
        });
        assert.ifError(result.error);
        assert.equal(
            result.status,
            permanent ? 1 : 0,
            `${result.stdout}\n${result.stderr}`,
        );
        assert.equal(
            fs.readFileSync(path.join(packageDir, "attempts"), "utf8"),
            permanent ? "3" : "2",
        );
        assert.match(
            result.stderr,
            /Full-package retry for node-retry-fixture/,
        );
        assert.match(
            result.stderr,
            permanent ? /BUILD-BLOCKING TEST FAILURES/ : /FLAKY TESTS/,
        );
        assert.equal(
            fs.readFileSync(path.join(directory, "root-ran"), "utf8"),
            "yes",
        );
        assert.equal(
            fs
                .readdirSync(directory)
                .some((name) => name.startsWith(".typeagent-test-failures-")),
            false,
        );
    });
}
