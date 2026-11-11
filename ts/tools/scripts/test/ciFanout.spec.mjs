// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
    createManifest,
    verifyManifest,
    stageArtifact,
    qualify,
    memoryTestSelection,
} from "../ciFanout.mjs";
import { localTestCommands, spawnPnpm } from "../runLocalTestPackages.mjs";
import { fanoutNodes } from "../lib/ciFanoutTargets.mjs";

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

test("artifact operations emit no timing records even with inherited profiling enabled", () => {
    fixture((root) =>
        fixture((consumer) => {
            for (const enabled of ["false", "true"]) {
                const directory = path.join(consumer, `payload-${enabled}`);
                const result = spawnSync(
                    process.execPath,
                    [
                        "--input-type=module",
                        "-e",
                        `
                            import { createManifest, verifyManifest, stageArtifact } from ${JSON.stringify(new URL("../ciFanout.mjs", import.meta.url).href)};
                            const manifest = createManifest(process.argv[1], ${JSON.stringify(sha)}, [${JSON.stringify(spec)}]);
                            verifyManifest(process.argv[1], ${JSON.stringify(sha)}, manifest);
                            stageArtifact(process.argv[1], manifest, process.argv[2]);
                        `,
                        root,
                        directory,
                    ],
                    {
                        encoding: "utf8",
                        env: {
                            ...process.env,
                            TYPEAGENT_CI_PROFILE: enabled,
                            GITHUB_SHA: "",
                            BUILD_SOURCEVERSION: "",
                        },
                    },
                );
                assert.equal(result.status, 0, result.stderr);
                assert.equal(result.stdout, "");
                assert.equal(
                    JSON.parse(
                        fs.readFileSync(
                            path.join(directory, "ci-fanout-manifest.json"),
                            "utf8",
                        ),
                    ).sha,
                    sha,
                );
            }
        }),
    );
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
        ["v24.22.1", "v26.12.1"].flatMap((node) => {
            const expectedTests = [1, 2, 3, 4].map(
                (number) => `test-${number}`,
            );
            return ["1", "2", "3", "4"].map((group) => {
                const files = [`test-${group}`];
                return {
                    sha,
                    platform,
                    node,
                    group,
                    manifestHash: `${platform}-${node}`,
                    expectedTests,
                    exitCode: 0,
                    success: true,
                    elapsedMs: 100,
                    files,
                    outcomes: files.map((name) =>
                        JSON.stringify([name, "assertion", "passed"]),
                    ),
                };
            });
        }),
    );
}

test("qualification checks complete shard inventories and assertion outcomes", () => {
    assert.deepEqual(
        qualify(reports(), sha).map((row) => row.slowestShardMs),
        Array(6).fill(100),
    );
});

test("CI qualification pins Node 24 and 26 independently of declared Node 22 support", () => {
    assert.deepEqual(fanoutNodes(), ["v24.22.1", "v26.12.1"]);
});

test("the production collector CLI writes summaries without retired control dependencies", () => {
    fixture((root, write) => {
        const head = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: new URL("../../../", import.meta.url),
            encoding: "utf8",
        }).trim();
        for (const [index, report] of reports().entries()) {
            write(
                `fanout-results/${index}.qualification.json`,
                JSON.stringify({ ...report, sha: head }),
            );
        }
        const summary = path.join(root, "summary.md");
        const result = spawnSync(
            process.execPath,
            [
                fileURLToPath(new URL("../ciFanout.mjs", import.meta.url)),
                "aggregate",
            ],
            {
                encoding: "utf8",
                env: {
                    ...process.env,
                    GITHUB_SHA: head,
                    RUNNER_TEMP: root,
                    GITHUB_STEP_SUMMARY: summary,
                },
            },
        );
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).length, 6);
        const text = fs.readFileSync(summary, "utf8");
        assert.match(
            text,
            /Complete shard inventory and per-file assertion qualification/,
        );
        assert.doesNotMatch(text, /Control \(s\)|controlMs|unsharded/);
    });
});

test("qualification requires all six targets without duplicate control runs", () => {
    const rows = reports();
    assert.equal(rows.length, 24);
    const summary = qualify(rows, sha);
    assert.equal(summary.length, 6);
    for (const row of summary) {
        assert.equal(row.controlMs, undefined);
        assert.equal(row.files, 4);
        assert.equal(row.assertions, 4);
        assert.equal(row.skippedAssertions, 0);
    }
    assert.throws(() =>
        qualify([...rows, { ...rows[0], group: "control" }], sha),
    );
});

test("shard-only qualification exposes existing skipped assertions rather than counting them as passes", () => {
    const rows = reports();
    rows[0].outcomes = [JSON.stringify(["test-1", "assertion", "pending"])];
    assert.equal(qualify(rows, sha)[0].skippedAssertions, 1);
});

for (const [name, change] of [
    ["missing shard", (rows) => rows.pop()],
    [
        "unselected Node",
        (rows) => {
            rows[0].node = "v22.23.4";
        },
    ],
    [
        "unexpected control",
        (rows) => {
            rows[0].group = "control";
        },
    ],
    [
        "wrong SHA",
        (rows) => {
            rows[0].sha = "b".repeat(40);
        },
    ],
    [
        "mixed artifact",
        (rows) => {
            rows[0].manifestHash = "different";
        },
    ],
    [
        "failed process",
        (rows) => {
            rows[0].exitCode = 1;
        },
    ],
    [
        "unsuccessful result",
        (rows) => {
            rows[0].success = false;
        },
    ],
    [
        "missing file",
        (rows) => {
            rows[0].files = [];
        },
    ],
    [
        "duplicate file",
        (rows) => {
            rows[0].files.push("test-2");
        },
    ],
    [
        "missing assertions",
        (rows) => {
            rows[0].outcomes = [];
        },
    ],
    [
        "malformed assertion",
        (rows) => {
            rows[0].outcomes = ["not JSON"];
        },
    ],
    [
        "failed assertion",
        (rows) => {
            rows[0].outcomes = [
                JSON.stringify(["test-1", "assertion", "failed"]),
            ];
        },
    ],
    [
        "assertion outside shard",
        (rows) => {
            rows[0].outcomes = [
                JSON.stringify(["test-2", "assertion", "passed"]),
            ];
        },
    ],
]) {
    test(`shard-only qualification rejects ${name}`, () => {
        const rows = reports();
        change(rows);
        assert.throws(() => qualify(rows, sha));
    });
}

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

function matrixValue(expression, inputs, github = {}, required = "true") {
    return vm.runInNewContext(expression.slice(3, -2), {
        inputs,
        github,
        needs: { changes: { outputs: { required } } },
        fromJSON: JSON.parse,
    });
}

test("production CI uses Node 24/26 and four shards without rollout selectors", () => {
    const main = workflow("build-ts");
    const experiment = workflow("ci-fanout");
    const target = workflow("ci-fanout-target");
    const inputs = main.on.workflow_dispatch.inputs;
    assert.equal(inputs.fanout_node_set, undefined);
    assert.equal(inputs.fanout_experiment, undefined);
    assert.equal(inputs.fanout_include_controls, undefined);
    assert.equal(experiment.on.workflow_call.inputs.node_set, undefined);
    assert.equal(
        experiment.on.workflow_call.inputs.include_controls,
        undefined,
    );
    assert.equal(target.on.workflow_call.inputs.include_controls, undefined);
    assert.equal(main.jobs.sharded.with.node_set, undefined);
    assert.equal(main.jobs.sharded.with.include_controls, undefined);
    assert.deepEqual(experiment.jobs.qualification.env, {
        TYPEAGENT_FULL_MACOS_QUALIFICATION: "${{ inputs.full_macos }}",
        pnpm_config_verify_deps_before_run: "false",
    });
    for (const matrix of [
        main.jobs.build_ts.strategy.matrix,
        experiment.jobs.targets.strategy.matrix,
    ]) {
        assert.deepEqual(matrix.version, ["24.22.1", "26.12.1"]);
        assert.deepEqual(
            matrix.version,
            fanoutNodes().map((node) => node.slice(1)),
        );
    }
    assert.deepEqual(target.jobs.test.strategy.matrix.group, [
        "1",
        "2",
        "3",
        "4",
    ]);
});

test("the production graph has 86 jobs including the aggregate and six migration aliases", () => {
    const main = workflow("build-ts");
    const experiment = workflow("ci-fanout");
    const target = workflow("ci-fanout-target");
    const matrix = experiment.jobs.targets.strategy.matrix;
    const platforms = matrixValue(matrix.os, { full_macos: false });
    let jobs = 4 + platforms.length * matrix.version.length;
    for (const os of platforms) {
        for (const version of matrix.version) {
            const inputs = { os, version };
            for (const job of Object.values(target.jobs)) {
                if (job.if && !vm.runInNewContext(job.if, { inputs })) {
                    continue;
                }
                jobs += Object.values(job.strategy?.matrix ?? {}).reduce(
                    (count, values) =>
                        count *
                        (Array.isArray(values)
                            ? values
                            : matrixValue(values, inputs)
                        ).length,
                    1,
                );
            }
        }
    }
    assert.equal(jobs, 86);
    assert.deepEqual(
        main.jobs.build_ts.strategy.matrix.version,
        matrix.version,
    );
});

test("every trigger uses sharding and scheduled runs select full macOS coverage", () => {
    const main = workflow("build-ts");
    assert.equal(main.jobs.build_ts_legacy, undefined);
    assert.equal(main.jobs.sharded.uses, "./.github/workflows/ci-fanout.yml");
    for (const trigger of ["push", "pull_request", "merge_group", "schedule"]) {
        assert.ok(main.on[trigger]);
    }
    for (const event of [
        "push",
        "pull_request",
        "merge_group",
        "schedule",
        "workflow_dispatch",
    ]) {
        const github = { event_name: event };
        const inputs = { macos_qualification: false };
        assert.equal(matrixValue(main.jobs.sharded.if, inputs, github), true);
        assert.equal(
            matrixValue(main.jobs.sharded.with.full_macos, inputs, github),
            event === "schedule",
        );
        assert.deepEqual(main.jobs.build_ts.strategy.matrix.version, [
            "24.22.1",
            "26.12.1",
        ]);
        assert.deepEqual(
            matrixValue(main.jobs.build_ts.strategy.matrix.os, inputs, github),
            event === "schedule"
                ? ["macos-latest"]
                : ["ubuntu-latest", "windows-latest", "macos-latest"],
        );
    }
    assert.equal(main.jobs.typescript_ci.name, "TypeScript CI");
    assert.equal(main.jobs.typescript_ci.if, "${{ always() }}");
    assert.deepEqual(main.jobs.typescript_ci.needs, ["changes", "sharded"]);
    assert.equal(main.jobs.typescript_ci["runs-on"], "ubuntu-latest");
    assert.equal(main.jobs.build_ts.needs, "typescript_ci");
    assert.equal(main.jobs.build_ts.if, "${{ always() }}");
});

test("manual macOS qualification selects only the full nightly matrix and its matching aggregate", () => {
    const main = workflow("build-ts");
    assert.equal(
        main.on.workflow_dispatch.inputs.macos_qualification.default,
        false,
    );
    const github = { event_name: "workflow_dispatch" };
    for (const macos of [true, false]) {
        const inputs = { macos_qualification: macos };
        assert.equal(matrixValue(main.jobs.sharded.if, inputs, github), true);
        assert.equal(
            matrixValue(main.jobs.sharded.with.full_macos, inputs, github),
            macos,
        );
        assert.deepEqual(
            matrixValue(main.jobs.build_ts.strategy.matrix.os, inputs, github),
            macos
                ? ["macos-latest"]
                : ["ubuntu-latest", "windows-latest", "macos-latest"],
        );
    }
});

for (const gate of ["typescript_ci", "build_ts"]) {
    for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
        test(`required checks fail closed: gate=${gate}, result=${result || "missing"}`, () => {
            const step = workflow("build-ts").jobs[gate].steps[0];
            const child = spawnSync(
                "pwsh",
                ["-NoProfile", "-NonInteractive", "-Command", step.run],
                {
                    encoding: "utf8",
                    timeout: 15_000,
                    env: {
                        ...process.env,
                        CI_CHANGES_RESULT: "success",
                        CI_COVERAGE_REQUIRED: "true",
                        CI_SHARDED_RESULT: result,
                        CI_AGGREGATE_RESULT: result,
                    },
                },
            );
            assert.ifError(child.error);
            assert.equal(
                child.status === 0,
                result === "success",
                child.stderr,
            );
        });
    }
}

test("documentation-only PRs skip work only after a successful explicit path decision", () => {
    const main = workflow("build-ts");
    const event = { event_name: "pull_request" };
    for (const strategy of ["sharded"]) {
        assert.equal(
            matrixValue(main.jobs[strategy].if, {}, event, "false"),
            false,
        );
        assert.equal(main.jobs[strategy].needs, "changes");
    }
    const filter = main.jobs.changes.steps.find((step) => step.id === "filter");
    assert.equal(filter["continue-on-error"], undefined);
    for (const path of [
        "ts/**",
        ".github/workflows/build-ts.yml",
        ".github/workflows/ci-fanout*.yml",
        ".github/actions/fanout-setup/**",
    ]) {
        assert.ok(filter.with.filters.includes(`"${path}"`));
    }
    for (const [result, decision, passed] of [
        ["success", "false", true],
        ["failure", "false", false],
        ["success", "", false],
    ]) {
        const child = spawnSync(
            "pwsh",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                main.jobs.typescript_ci.steps[0].run,
            ],
            {
                encoding: "utf8",
                timeout: 15_000,
                env: {
                    ...process.env,
                    CI_CHANGES_RESULT: result,
                    CI_COVERAGE_REQUIRED: decision,
                    CI_SHARDED_RESULT: "skipped",
                },
            },
        );
        assert.ifError(child.error);
        assert.equal(child.status === 0, passed, child.stderr);
    }
});

test("sharded PR analysis retains changed formatting and all four ratchets", () => {
    const steps = workflow("ci-fanout").jobs.analysis.steps;
    const format = steps.find((step) => step.env?.CI_EVENT_NAME);
    assert.ok(
        format.run.includes("git fetch --no-tags origin $env:CI_BASE_REF"),
    );
    assert.ok(
        format.run.includes(
            'prettier-changed.mjs --base "origin/$env:CI_BASE_REF"',
        ),
    );
    assert.ok(format.run.includes("npm run lint"));
    for (const command of [
        "code-complexity",
        "code-lint",
        "code-circular",
        "code-debt",
    ]) {
        const gates = steps.filter((step) =>
            step.run?.includes(`npm run ${command} `),
        );
        assert.equal(gates.length, 1, command);
        assert.equal(gates[0].if, "github.event_name == 'pull_request'");
        assert.equal(gates[0].env.CI_BASE_REF, "${{ github.base_ref }}");
        assert.ok(gates[0].run.includes('--base "origin/$env:CI_BASE_REF"'));
    }
});

test("Linux prerequisites bound apt network waits and propagate failures", () => {
    const setup = yaml.load(
        fs.readFileSync(
            new URL(
                "../../../../.github/actions/fanout-setup/action.yml",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    const linux = setup.runs.steps.find(
        (step) => step.if === "runner.os == 'Linux'",
    );
    assert.equal(linux.shell, "pwsh");
    for (const protocol of ["http", "https"])
        assert.ok(linux.run.includes(`Acquire::${protocol}::Timeout=30`));
    assert.ok(linux.run.includes("Acquire::Retries=2"));
    for (const command of [
        "-o APT::Update::Error-Mode=any update",
        "install -y libsecret-1-dev",
    ])
        assert.ok(
            linux.run.includes(
                `timeout --kill-after=15s 180s sudo apt-get @aptOptions ${command}`,
            ),
        );
    assert.equal(
        linux.run.match(
            /if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/g,
        )?.length,
        2,
    );
});

test("test runners install native dependencies but never rebuild shared product output", () => {
    const experiment = workflow("ci-fanout");
    const target = workflow("ci-fanout-target");
    assert.deepEqual(Object.keys(experiment.on), ["workflow_call"]);
    assert.deepEqual(experiment.permissions, { contents: "read" });
    assert.deepEqual(target.permissions, { contents: "read" });
    assert.deepEqual(
        matrixValue(experiment.jobs.targets.strategy.matrix.os, {
            full_macos: false,
        }),
        ["ubuntu-latest", "windows-latest", "macos-latest"],
    );
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
    ]);
    assert.equal(target.jobs.test.needs, "build");
    assert.equal(target.jobs.test.strategy["fail-fast"], false);
    const commands = target.jobs.test.steps
        .map((step) => step.run ?? "")
        .join("\n");
    assert.match(commands, /ciFanout.mjs test/);
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

test("full macOS qualification uses four sequential complete-package lanes, roots and fail-closed collection", () => {
    const main = workflow("build-ts");
    const experiment = workflow("ci-fanout");
    const target = workflow("ci-fanout-target");
    const inputs = { full_macos: true, os: "macos-latest" };
    assert.deepEqual(
        matrixValue(experiment.jobs.targets.strategy.matrix.os, inputs),
        ["macos-latest"],
    );
    assert.equal(
        main.jobs.sharded.with.full_macos,
        "${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.macos_qualification) }}",
    );
    assert.equal(
        experiment.jobs.targets.with.full_macos,
        "${{ inputs.full_macos }}",
    );
    assert.equal(
        target.env.TYPEAGENT_FULL_MACOS_QUALIFICATION,
        "${{ inputs.full_macos }}",
    );
    assert.equal(
        experiment.jobs.qualification.env.TYPEAGENT_FULL_MACOS_QUALIFICATION,
        "${{ inputs.full_macos }}",
    );
    assert.deepEqual(
        matrixValue(target.jobs.remainder.strategy.matrix.group, inputs),
        ["1", "2", "3", "4"],
    );
    assert.equal(
        matrixValue(target.jobs.remainder["timeout-minutes"], inputs),
        240,
    );
    const step = target.jobs.remainder.steps.find(
        (step) => step.env?.TYPEAGENT_REMAINDER_ARTIFACT_SCOPE,
    );
    assert.equal(
        matrixValue(step.env.TYPEAGENT_TEST_WORKSPACE_TIMEOUT_MS, inputs),
        "10800000",
    );
    for (const name of ["build", "test", "package_partitions"]) {
        assert.equal(
            vm.runInNewContext(target.jobs[name].if, { inputs }),
            false,
        );
    }
    for (const name of ["workspace_build", "remainder", "roots"]) {
        assert.equal(target.jobs[name].if, undefined);
    }
    for (const step of experiment.jobs.qualification.steps) {
        if (
            step.with?.pattern?.match(/^fanout-(result|partition)-/) ||
            step.run?.match(/(?:ciFanout|ciPackagePartitions)\.mjs aggregate/)
        ) {
            assert.equal(vm.runInNewContext(step.if, { inputs }), false);
        }
    }
    assert.equal(
        experiment.jobs.qualification.steps.find((step) =>
            step.run?.includes("ciWorkspaceLanes.mjs aggregate"),
        ).if,
        undefined,
    );
    const roots = target.jobs.roots.steps.find(
        (step) => step.env?.TYPEAGENT_TEST_PHASE === "scripts",
    );
    assert.equal(roots.env.TYPEAGENT_FULL_MACOS_QUALIFICATION, "false");
});

test("platform-independent analysis runs once and remains blocking", () => {
    const experiment = workflow("ci-fanout");
    const analysis = experiment.jobs.analysis;
    assert.equal(analysis.strategy, undefined);
    assert.ok(
        analysis.steps.some((step) => step.run?.includes("npm run lint")),
    );
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
        '${{ inputs.os == \'macos-latest\' && !inputs.full_macos && fromJSON(\'["1"]\') || fromJSON(\'["1","2","3","4"]\') }}',
    );
    const qualification = workflow("ci-fanout").jobs.qualification;
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

test("orchestration entrypoints establish pnpm's shell-free package-script context", () => {
    const scripts = JSON.parse(
        fs.readFileSync(
            new URL("../../../package.json", import.meta.url),
            "utf8",
        ),
    ).scripts;
    assert.equal(scripts["ci:node"], "node");
    const commands = ["ci-fanout-target", "ci-fanout"].flatMap((name) =>
        Object.values(workflow(name).jobs).flatMap((job) =>
            (job.steps ?? []).flatMap((step) =>
                (step.run ?? "")
                    .split("\n")
                    .filter((line) => /tools\/scripts\/ci\w+\.mjs/.test(line)),
            ),
        ),
    );
    assert.equal(commands.length, 12);
    for (const command of commands)
        assert.match(command.trim(), /^pnpm run ci:node tools\/scripts\//);
});

test("qualification preserves pnpm context without installing workspace dependencies", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-collector-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            private: true,
            scripts: { "ci:node": "node" },
            dependencies: { "must-not-install": "file:./absent" },
        }),
    );
    fs.writeFileSync(
        path.join(root, "pnpm-workspace.yaml"),
        "packages: []\nverifyDepsBeforeRun: install\n",
    );
    const setting =
        workflow("ci-fanout").jobs.qualification.env
            .pnpm_config_verify_deps_before_run;
    assert.equal(setting, "false");
    const args = ["run", "ci:node", "-p", "process.env.npm_execpath"];
    const run = (value) =>
        spawnPnpm(args, {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                pnpm_config_verify_deps_before_run: value,
            },
        });
    const rejected = run("error");
    assert.ifError(rejected.error);
    assert.notEqual(rejected.status, 0);
    assert.match(
        rejected.stdout + rejected.stderr,
        /ERR_PNPM_VERIFY_DEPS_BEFORE_RUN/,
    );
    const accepted = run(setting);
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(
        accepted.stdout.trim().split(/\r?\n/).at(-1),
        /pnpm\.(?:mjs|cjs|js)$/,
    );
    assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(root, "pnpm-lock.yaml")), false);
});
