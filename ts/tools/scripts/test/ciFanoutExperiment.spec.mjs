// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import {
    createManifest,
    verifyManifest,
    stageArtifact,
    qualify,
} from "../ciFanoutExperiment.mjs";

const sha = "a".repeat(40);
const spec = "packages/memory/service/dist/test/example.spec.js";

function fixture(run) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-fanout-"));
    const write = (name, value) => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, value);
    };
    try {
        write("pnpm-lock.yaml", "synthetic lock");
        write(spec, "synthetic compiled test");
        write(
            "packages/commonUtils/dist/index.js",
            "synthetic compiled dependency",
        );
        write("node_modules/dependency/dist/index.js", "must not upload");
        write(".npmrc", "synthetic configuration excluded");
        return run(root, write);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test("compiled manifest round-trips without dependencies or credential files", () => {
    fixture((root) => {
        const manifest = createManifest(root, sha, [spec]);
        assert.equal(manifest.files.length, 2);
        assert.deepEqual(manifest.tests, [spec]);
        verifyManifest(root, sha, manifest);
    });
});

test("staged payload restores into a fresh consumer without dependency scanning", () => {
    fixture((root) =>
        fixture((consumer) => {
            const manifest = createManifest(root, sha, [spec]);
            const directory = path.join(consumer, "payload");
            stageArtifact(root, manifest, directory);
            assert.equal(
                fs.existsSync(path.join(directory, "node_modules")),
                false,
            );
            assert.equal(fs.existsSync(path.join(directory, ".npmrc")), false);
            assert.deepEqual(
                JSON.parse(
                    fs.readFileSync(
                        path.join(directory, "ci-fanout-manifest.json"),
                        "utf8",
                    ),
                ),
                manifest,
            );
            fs.copyFileSync(
                path.join(root, "pnpm-lock.yaml"),
                path.join(directory, "pnpm-lock.yaml"),
            );
            verifyManifest(directory, sha, manifest);
            assert.throws(
                () => stageArtifact(root, manifest, directory),
                /must be new/,
            );
        }),
    );
});

for (const key of ["sha", "platform", "arch", "node", "abi", "lockHash"]) {
    test(`artifact identity rejects a mismatched ${key}`, () => {
        fixture((root) => {
            const manifest = createManifest(root, sha, [spec]);
            manifest[key] = "incorrect";
            assert.throws(
                () => verifyManifest(root, sha, manifest),
                /mismatch/,
            );
        });
    });
}

test("missing, altered and unexpected outputs fail verification", () => {
    fixture((root, write) => {
        const manifest = createManifest(root, sha, [spec]);
        write(spec, "tampered");
        assert.throws(
            () => verifyManifest(root, sha, manifest),
            /Artifact size|Artifact hash/,
        );
        write(spec, "synthetic compiled test");
        write("extra/dist/unexpected.js", "unexpected");
        assert.throws(() => verifyManifest(root, sha, manifest));
        fs.rmSync(path.join(root, spec));
        assert.throws(() => verifyManifest(root, sha, manifest), /ENOENT/);
    });
});

for (const name of [
    "../outside/dist/file.js",
    "/dist/file.js",
    "C:/dist/file.js",
    "dist/.env",
    "dist/.npmrc",
    "dist/config.local.yaml",
]) {
    test(`rejects unsafe output path ${name}`, () => {
        fixture((root) => {
            const manifest = createManifest(root, sha, [spec]);
            manifest.files[0].path = name;
            assert.throws(
                () => verifyManifest(root, sha, manifest),
                /Unsafe artifact path/,
            );
        });
    });
}

test("credential-shaped compiled outputs and empty discovery are rejected", () => {
    fixture((root, write) => {
        assert.throws(() => createManifest(root, sha, []), /Empty/);
        assert.throws(
            () => createManifest(root, sha, [spec, spec]),
            /Duplicate/,
        );
        write("packages/example/dist/.env", "synthetic");
        assert.throws(() => createManifest(root, sha, [spec]), /Unsafe/);
    });
});

function reports() {
    return ["linux", "win32", "darwin"].flatMap((platform) =>
        ["v22.23.4", "v24.22.1", "v26.12.1"].flatMap((node) => {
            const expectedTests = [1, 2, 3, 4].map(
                (number) => `test-${number}`,
            );
            return ["1", "2", "3", "4", "control"].map((group) => {
                const files =
                    group === "control" ? expectedTests : [`test-${group}`];
                return {
                    sha,
                    platform,
                    node,
                    group,
                    manifestHash: `${platform}-${node}`,
                    expectedTests,
                    exitCode: 0,
                    success: true,
                    elapsedMs: group === "control" ? 400 : 100,
                    files,
                    outcomes: files.map((name) =>
                        JSON.stringify([name, "assertion", "passed"]),
                    ),
                };
            });
        }),
    );
}

test("qualification checks complete shard inventories and control assertion outcomes", () => {
    assert.deepEqual(
        qualify(reports(), sha).map((row) => row.slowestShardMs),
        Array(9).fill(100),
    );
});

for (const [name, change] of [
    ["missing/cancelled shard", (rows) => rows.pop()],
    [
        "wrong Node version",
        (rows) => {
            rows[0].node = "v24.0.0";
        },
    ],
    [
        "wrong OS",
        (rows) => {
            rows[0].platform = "unknown";
        },
    ],
    [
        "duplicate shard",
        (rows) => {
            rows[0].group = "2";
        },
    ],
    [
        "failed process",
        (rows) => {
            rows[0].exitCode = 1;
        },
    ],
    [
        "unsuccessful Jest result",
        (rows) => {
            rows[0].success = false;
        },
    ],
    [
        "wrong SHA",
        (rows) => {
            rows[0].sha = "b".repeat(40);
        },
    ],
    [
        "mixed build output",
        (rows) => {
            rows[0].manifestHash = "different";
        },
    ],
    [
        "missing test file",
        (rows) => {
            rows[0].files = [];
        },
    ],
    [
        "duplicate test file",
        (rows) => {
            rows[0].files.push("test-2");
        },
    ],
    [
        "changed assertion identity",
        (rows) => {
            rows[0].outcomes = [
                JSON.stringify(["test-1", "different assertion", "passed"]),
            ];
        },
    ],
    [
        "changed assertion outcome",
        (rows) => {
            rows[0].outcomes = ["failed"];
        },
    ],
    [
        "no assertions",
        (rows) => {
            for (const row of rows) row.outcomes = [];
        },
    ],
]) {
    test(`qualification rejects ${name}`, () => {
        const rows = reports();
        change(rows);
        assert.throws(() => qualify(rows, sha));
    });
}

function workflow(name) {
    return yaml.load(
        fs.readFileSync(
            new URL(
                `../../../../.github/workflows/${name}.yml`,
                import.meta.url,
            ),
            "utf8",
        ),
    );
}

test("fan-out is manual opt-in and does not replace PR, main or queue validation", () => {
    const main = workflow("build-ts");
    assert.equal(
        main.on.workflow_dispatch.inputs.fanout_experiment.default,
        false,
    );
    for (const trigger of ["push", "pull_request", "merge_group", "schedule"]) {
        assert.ok(main.on[trigger]);
    }
    assert.equal(
        main.jobs.fanout_experiment.if,
        "${{ github.event_name == 'workflow_dispatch' && inputs.fanout_experiment }}",
    );
    assert.equal(
        main.jobs.build_ts.if,
        "${{ github.event_name != 'workflow_dispatch' || !inputs.fanout_experiment }}",
    );
    assert.deepEqual(main.jobs.build_ts.strategy.matrix.version, [
        "22.23.4",
        "24.22.1",
        "26.12.1",
    ]);
});

test("test runners install native dependencies but never rebuild shared product output", () => {
    const experiment = workflow("ci-fanout-experiment");
    assert.deepEqual(Object.keys(experiment.on), ["workflow_call"]);
    assert.deepEqual(experiment.permissions, { contents: "read" });
    assert.deepEqual(experiment.jobs.build.strategy.matrix.os, [
        "ubuntu-latest",
        "windows-latest",
        "macos-latest",
    ]);
    assert.equal(
        experiment.jobs.build.steps.find((step) =>
            step.name?.startsWith("Build memory service"),
        ).run,
        'npm exec --no -- fluid-build "^@typeagent/memory-client$" -t build --dep',
    );
    assert.deepEqual(
        experiment.jobs.build.strategy.matrix.version,
        workflow("build-ts").jobs.build_ts.strategy.matrix.version,
    );
    assert.deepEqual(
        experiment.jobs.test.strategy.matrix.version,
        experiment.jobs.build.strategy.matrix.version,
    );
    assert.deepEqual(
        experiment.jobs.test.strategy.matrix.os,
        experiment.jobs.build.strategy.matrix.os,
    );
    for (const job of ["build", "test"]) {
        assert.equal(
            experiment.jobs[job].steps.find((step) =>
                step.uses?.startsWith("actions/setup-node@"),
            ).with["node-version"],
            "${{ matrix.version }}",
        );
    }
    assert.equal(
        experiment.jobs.build.steps.find((step) =>
            step.uses?.startsWith("actions/upload-artifact@"),
        ).with.path,
        "${{ runner.temp }}/fanout-build",
    );
    assert.deepEqual(experiment.jobs.test.strategy.matrix.group, [
        "1",
        "2",
        "3",
        "4",
        "control",
    ]);
    assert.equal(experiment.jobs.test.needs, "build");
    assert.equal(experiment.jobs.test.strategy.fail_fast, undefined);
    assert.equal(experiment.jobs.test.strategy["fail-fast"], false);
    const commands = experiment.jobs.test.steps
        .map((step) => step.run ?? "")
        .join("\n");
    assert.match(commands, /pnpm install --frozen-lockfile/);
    assert.match(commands, /ciFanoutExperiment.mjs test/);
    assert.doesNotMatch(commands, /fluid-build|run build|getKeys/);
    assert.equal(experiment.jobs.qualification.if, "always()");
    assert.deepEqual(experiment.jobs.qualification.needs, [
        "analysis",
        "build",
        "test",
    ]);
    assert.ok(
        experiment.jobs.qualification.steps.some((step) =>
            step.if?.includes("needs.test.result != 'success'"),
        ),
    );
});

test("platform-independent analysis runs once and remains blocking", () => {
    const experiment = workflow("ci-fanout-experiment");
    const analysis = experiment.jobs.analysis;
    assert.equal(analysis.strategy, undefined);
    assert.ok(analysis.steps.some((step) => step.run === "npm run lint"));
    assert.equal(
        experiment.jobs.build.steps.some((step) => step.run === "npm run lint"),
        false,
    );
    assert.ok(
        experiment.jobs.qualification.steps.some((step) =>
            step.if?.includes("needs.analysis.result != 'success'"),
        ),
    );
});

test("full qualification preserves remaining packages, script retries and Linux UI tests", () => {
    const experiment = workflow("ci-fanout-experiment");
    const steps = experiment.jobs.build.steps;
    const testStep = steps.find((step) =>
        step.name?.startsWith("Test remaining packages"),
    );
    assert.equal(testStep.env.TYPEAGENT_TEST_PROFILE, "full-without-memory");
    assert.match(testStep.run, /runTestLocalWithSummary.mjs/);
    assert.match(testStep.run, /exit \$LASTEXITCODE/);
    assert.equal(
        testStep.env.TYPEAGENT_SKIP_POWERSHELL_BROKER_TESTS,
        workflow("build-ts").jobs.build_ts.steps.find(
            (step) => step.name === "Test",
        ).env.TYPEAGENT_SKIP_POWERSHELL_BROKER_TESTS,
    );
    const ui = steps.find(
        (step) => step.name === "UI tests (requires display)",
    );
    assert.equal(ui.if, "runner.os == 'Linux'");
    assert.match(ui.run, /npm run test:ui/);
    assert.match(ui.run, /trap .*EXIT/);
    const buildArtifact = steps.find((step) =>
        step.uses?.startsWith("actions/upload-artifact@"),
    );
    const download = experiment.jobs.test.steps.find((step) =>
        step.uses?.startsWith("actions/download-artifact@"),
    );
    const workspaceBuild = steps.find((step) =>
        step.name?.startsWith("Build remaining workspace"),
    );
    assert.equal(workspaceBuild.run, "pnpm run build");
    assert.ok(steps.indexOf(buildArtifact) < steps.indexOf(workspaceBuild));
    assert.ok(steps.indexOf(workspaceBuild) < steps.indexOf(testStep));
    assert.equal(buildArtifact.with.name, download.with.name);
    assert.match(buildArtifact.with.name, /matrix.version/);
    assert.match(
        experiment.jobs.test.steps.find((step) =>
            step.uses?.startsWith("actions/upload-artifact@"),
        ).with.name,
        /matrix.version/,
    );
});
