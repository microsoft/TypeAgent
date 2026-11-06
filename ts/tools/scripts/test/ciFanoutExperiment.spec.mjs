// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import yaml from "js-yaml";
import {
    createManifest,
    verifyManifest,
    stageArtifact,
    qualify,
    memoryTestSelection,
} from "../ciFanoutExperiment.mjs";
import { localTestCommands } from "../runLocalTestPackages.mjs";

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

test("workspace artifacts reuse transport verification but cannot masquerade as memory artifacts", () => {
    fixture((root, write) => {
        const test = "packages/dispatcher/dispatcher/dist/test/example.spec.js";
        write(test, "synthetic workspace test");
        const manifest = createManifest(root, sha, [test], "workspace");
        verifyManifest(root, sha, manifest, "workspace");
        assert.throws(
            () => verifyManifest(root, sha, manifest),
            /scope mismatch/,
        );
        assert.throws(
            () => createManifest(root, sha, [test]),
            /compiled memory/,
        );
        verifyManifest(
            root,
            sha,
            createManifest(root, sha, [], "workspace"),
            "workspace",
        );
        assert.throws(() => createManifest(root, sha, [], "unknown"), /scope/);
    });
});

test("macOS memory discovery and execution select only the existing compatibility suites", () => {
    fixture((root, write) => {
        const compatibility = localTestCommands("macos-compat", root);
        const memory = compatibility.find(
            ({ cwd }) => cwd === path.resolve(root, "packages/memory/service"),
        );
        for (const file of memory.args.slice(3)) {
            write(path.relative(root, file), "synthetic compatibility test");
        }
        const selection = memoryTestSelection(root, "darwin");
        assert.deepEqual(selection, memory.args.slice(2));
        assert.equal(selection[0], "--runTestsByPath");
        assert.equal(selection.length, 6);
        const remainder = localTestCommands(
            "macos-compat-without-memory",
            root,
        );
        assert.deepEqual(
            [
                ...selection.slice(1),
                ...remainder.flatMap(({ args }) => args.slice(3)),
            ].sort(),
            compatibility.flatMap(({ args }) => args.slice(3)).sort(),
        );
        fs.rmSync(selection[1]);
        assert.throws(
            () => memoryTestSelection(root, "darwin"),
            /ENOENT|Missing compiled/,
        );
    });
});

test("Linux and Windows memory discovery and execution retain the complete spec selection", () => {
    for (const platform of ["linux", "win32"]) {
        assert.deepEqual(memoryTestSelection("unused", platform), [
            "--testPathPattern=.*[.]spec[.]js",
        ]);
    }
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
    const target = workflow("ci-fanout-target");
    assert.deepEqual(Object.keys(experiment.on), ["workflow_call"]);
    assert.deepEqual(experiment.permissions, { contents: "read" });
    assert.deepEqual(target.permissions, { contents: "read" });
    assert.deepEqual(experiment.jobs.targets.strategy.matrix.os, [
        "ubuntu-latest",
        "windows-latest",
        "macos-latest",
    ]);
    assert.equal(
        target.jobs.build.steps.find((step) =>
            step.name?.startsWith("Build memory service"),
        ).run,
        'npm exec --no -- fluid-build "^@typeagent/memory-client$" -t build --dep',
    );
    assert.deepEqual(
        experiment.jobs.targets.strategy.matrix.version,
        workflow("build-ts").jobs.build_ts.strategy.matrix.version,
    );
    assert.equal(
        experiment.jobs.targets.uses,
        "./.github/workflows/ci-fanout-target.yml",
    );
    for (const job of Object.values(target.jobs)) {
        assert.equal(job["runs-on"], "${{ inputs.os }}");
        assert.equal(
            job.steps.find(
                (step) => step.uses === "./.github/actions/fanout-setup",
            ).with["node-version"],
            "${{ inputs.version }}",
        );
        assert.equal(
            job.strategy?.matrix.os,
            undefined,
            "A target must not introduce another OS-wide barrier",
        );
        assert.equal(job.strategy?.matrix.version, undefined);
        assert.equal(job["continue-on-error"], undefined);
    }
    assert.equal(
        target.jobs.build.steps.find((step) =>
            step.uses?.startsWith("actions/upload-artifact@"),
        ).with.path,
        "${{ runner.temp }}/fanout-build",
    );
    assert.deepEqual(target.jobs.test.strategy.matrix.group, [
        "1",
        "2",
        "3",
        "4",
        "control",
    ]);
    assert.equal(target.jobs.test.needs, "build");
    assert.equal(target.jobs.test.strategy["fail-fast"], false);
    const commands = target.jobs.test.steps
        .map((step) => step.run ?? "")
        .join("\n");
    assert.match(commands, /ciFanoutExperiment.mjs test/);
    assert.doesNotMatch(commands, /fluid-build|run build|getKeys/);
    assert.equal(experiment.jobs.qualification.if, "always()");
    assert.deepEqual(experiment.jobs.qualification.needs, [
        "analysis",
        "targets",
    ]);
    assert.ok(
        experiment.jobs.qualification.steps.some((step) =>
            step.if?.includes("needs.targets.result != 'success'"),
        ),
    );
});

test("platform-independent analysis runs once and remains blocking", () => {
    const experiment = workflow("ci-fanout-experiment");
    const analysis = experiment.jobs.analysis;
    assert.equal(analysis.strategy, undefined);
    assert.ok(analysis.steps.some((step) => step.run === "npm run lint"));
    assert.equal(
        workflow("ci-fanout-target").jobs.build.steps.some(
            (step) => step.run === "npm run lint",
        ),
        false,
    );
    assert.ok(
        experiment.jobs.qualification.steps.some((step) =>
            step.if?.includes("needs.analysis.result != 'success'"),
        ),
    );
});

test("qualification preserves gated platform selections, script retries and Linux UI tests", () => {
    const experiment = workflow("ci-fanout-target");
    const steps = experiment.jobs.remainder.steps;
    const testStep = steps.find((step) =>
        step.name?.startsWith("Test duration-balanced whole-package"),
    );
    for (const os of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
        assert.equal(
            vm.runInNewContext(
                experiment.env.TYPEAGENT_SKIP_POWERSHELL_BROKER_TESTS.slice(
                    3,
                    -2,
                ),
                { inputs: { os } },
            ),
            os === "windows-latest" ? "1" : "0",
        );
    }
    assert.match(testStep.run, /ciWorkspaceLanes.mjs test/);
    assert.match(testStep.run, /exit \$LASTEXITCODE/);
    const ui = experiment.jobs.roots.steps.find(
        (step) => step.name === "UI tests (requires display)",
    );
    assert.equal(ui.if, "runner.os == 'Linux'");
    assert.match(ui.run, /npm run test:ui/);
    assert.match(ui.run, /trap .*EXIT/);
    const buildArtifact = experiment.jobs.build.steps.find((step) =>
        step.uses?.startsWith("actions/upload-artifact@"),
    );
    const download = experiment.jobs.test.steps.find((step) =>
        step.uses?.startsWith("actions/download-artifact@"),
    );
    assert.equal(buildArtifact.with.name, download.with.name);
    assert.match(buildArtifact.with.name, /inputs.version/);
    assert.match(
        experiment.jobs.test.steps.find((step) =>
            step.uses?.startsWith("actions/upload-artifact@"),
        ).with.name,
        /inputs.version/,
    );
});

test("memory producers never wait for or run non-memory builds or tests", () => {
    const jobs = workflow("ci-fanout-target").jobs;
    assert.equal(jobs.build.needs, undefined);
    assert.equal(jobs.workspace_build.needs, undefined);
    const memoryCommands = jobs.build.steps
        .map((step) => step.run ?? "")
        .join("\n");
    assert.doesNotMatch(
        memoryCommands,
        /pnpm run build|runTestLocalWithSummary|ciPackagePartitions/,
    );
    assert.equal(jobs.test.needs, "build");
    const workspaceCommands = jobs.workspace_build.steps
        .map((step) => step.run ?? "")
        .join("\n");
    assert.match(workspaceCommands, /pnpm run build/);
    assert.match(workspaceCommands, /ciPackagePartitions.mjs prepare/);
    assert.doesNotMatch(
        workspaceCommands,
        /runTestLocalWithSummary|ciPackagePartitions.mjs test/,
    );
    for (const name of ["remainder", "package_partitions", "roots"]) {
        assert.equal(jobs[name].needs, "workspace_build");
        const commands = jobs[name].steps
            .map((step) => step.run ?? "")
            .join("\n");
        assert.doesNotMatch(commands, /pnpm run build|fluid-build/);
        const download = jobs[name].steps.find((step) =>
            step.uses?.startsWith("actions/download-artifact@"),
        );
        if (["roots", "ui"].includes(name))
            assert.equal(
                download.with.name,
                jobs.workspace_build.steps.find((step) =>
                    step.uses?.startsWith("actions/upload-artifact@"),
                ).with.name,
            );
    }
    assert.equal(jobs.package_partitions.if, "inputs.os != 'macos-latest'");
    assert.deepEqual(jobs.package_partitions.strategy.matrix.group, [
        "1",
        "2",
        "3",
        "4",
    ]);
    assert.equal(jobs.roots.if, undefined);
    assert.equal(
        jobs.roots.steps.find((step) =>
            step.name?.startsWith("Profile independent"),
        ).env.TYPEAGENT_TEST_PHASE,
        "scripts",
    );
    assert.equal(
        jobs.remainder.strategy.matrix.group,
        '${{ inputs.os == \'macos-latest\' && fromJSON(\'["1"]\') || fromJSON(\'["1","2","3","4"]\') }}',
    );
    const qualification = workflow("ci-fanout-experiment").jobs.qualification;
    assert.ok(
        qualification.steps.findIndex((step) =>
            step.name?.startsWith("Reject failed"),
        ) <
            qualification.steps.findIndex((step) =>
                step.uses?.startsWith("actions/download-artifact@"),
            ),
    );
    assert.ok(
        qualification.steps.some((step) =>
            step.run?.includes("ciPackagePartitions.mjs aggregate"),
        ),
    );
    assert.ok(
        qualification.steps.some((step) =>
            step.run?.includes("ciWorkspaceLanes.mjs aggregate"),
        ),
    );
});
