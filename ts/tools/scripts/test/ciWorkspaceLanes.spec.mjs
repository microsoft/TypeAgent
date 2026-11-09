// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { localTestCommands } from "../runLocalTestPackages.mjs";
import { runLocalTestPhases } from "../lib/testRetry.mjs";
import { readWorkspace } from "../ciWorkspaceLanes.mjs";
import {
    packageTimingsFromLog,
    planLanes,
    qualifyLanes,
    remainderPackages,
    runtimeClosure,
} from "../lib/ciWorkspaceLanes.mjs";

const packages = Array.from({ length: 12 }, (_, i) => ({
    name: `package-${i}`,
    directory: `packages/package-${i}`,
    scripts: {
        "test:local":
            i === 0
                ? "jest && npm run layout && npm run launcher"
                : "test-command",
    },
}));
const timings = Object.fromEntries(
    packages.map((pkg, i) => [pkg.name, (i + 1) * 100]),
);
const compatibility = packages.slice(0, 4).map((pkg) => pkg.directory);
const plans = Object.fromEntries(
    ["linux", "win32", "darwin"].map((platform) => [
        platform,
        planLanes(packages, timings, platform, compatibility),
    ]),
);
const sha = "a".repeat(40);

test("the final collector discovers exact package scripts without installing native dependencies", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-collector-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "root",
            private: true,
            packageManager: "pnpm@11.9.0",
        }),
    );
    fs.writeFileSync(
        path.join(root, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n",
    );
    const directory = path.join(root, "packages", "test-package");
    fs.mkdirSync(directory, { recursive: true });
    const scripts = { "test:local": "jest && node layout && node launcher" };
    fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ name: "test-package", version: "1.0.0", scripts }),
    );
    const aliasParent = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-collector-alias-"),
    );
    t.after(() => fs.rmSync(aliasParent, { recursive: true, force: true }));
    const alias = path.join(aliasParent, "workspace");
    fs.symlinkSync(
        root,
        alias,
        process.platform === "win32" ? "junction" : "dir",
    );
    for (const directory of [root, alias]) {
        const inventory = readWorkspace(directory);
        assert.deepEqual(
            inventory.map((pkg) => ({
                name: pkg.name,
                directory: pkg.directory,
                scripts: pkg.scripts,
            })),
            [
                {
                    name: "test-package",
                    directory: "packages/test-package",
                    scripts,
                },
            ],
        );
    }
    assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
});

test("whole-package lanes are deterministic, complete and preserve chained scripts", () => {
    const plan = plans.win32;
    assert.deepEqual(
        plan,
        planLanes([...packages].reverse(), timings, "win32", compatibility),
    );
    assert.deepEqual(
        plan.groups.flatMap((group) => group.files).sort(),
        packages.map((pkg) => pkg.name).sort(),
    );
    assert.equal(
        plan.packages.find((pkg) => pkg.name === "package-0").scripts[
            "test:local"
        ],
        packages[0].scripts["test:local"],
    );
    assert.equal(plan.unprofiled.length, 0);
    for (const group of plan.groups) {
        const command = localTestCommands(
            "fanout-lane",
            "workspace",
            3,
            group.files,
        )[0];
        assert.deepEqual(command.args.slice(-2), ["run", "test:local"]);
        assert.ok(command.args.includes("--workspace-concurrency=3"));
        assert.deepEqual(
            command.args.filter((arg) => arg.startsWith("--filter=")),
            group.files.map((name) => `--filter=${name}`),
        );
    }
});

test("only memory, dispatcher and provider leave full remainder coverage", () => {
    const all = [
        ...packages,
        ...[
            "@typeagent/memory-service",
            "agent-dispatcher",
            "default-agent-provider",
        ].map((name) => ({ name, scripts: { "test:local": "original" } })),
        { name: "no-tests", scripts: {} },
    ];
    assert.deepEqual(
        remainderPackages(all),
        [...packages].sort((a, b) => a.name.localeCompare(b.name)),
    );
});

test("macOS uses only canonical compatibility directories in one lane", () => {
    assert.equal(plans.darwin.groups.length, 1);
    assert.deepEqual(
        plans.darwin.groups[0].files,
        packages
            .slice(0, 4)
            .map((pkg) => pkg.name)
            .sort(),
    );
    assert.throws(
        () => planLanes(packages.slice(1), timings, "darwin", compatibility),
        /compatibility/,
    );
});

test("new packages are included with explicit median weights", () => {
    const plan = planLanes(packages, {}, "linux", compatibility);
    assert.equal(plan.unprofiled.length, packages.length);
    assert.equal(plan.fallbackMs, 1000);
});

test("invalid or excluded package selections cannot launch a lane", () => {
    for (const selection of [
        undefined,
        [],
        ["package-1", "package-1"],
        ["..."],
        ["package..."],
        ["--all"],
        ["@typeagent/memory-service"],
        ["agent-dispatcher"],
        ["default-agent-provider"],
    ]) {
        assert.throws(
            () => localTestCommands("fanout-lane", "workspace", 3, selection),
            /selection/,
        );
    }
});

test("runtime closures retain transitive, optional and test dependencies including dynamic agents", () => {
    const inventory = [
        {
            name: "provider",
            directory: "packages/provider",
            dependencies: { agent: "workspace:*" },
        },
        {
            name: "agent",
            directory: "packages/agent",
            optionalDependencies: { runtime: "workspace:*" },
            devDependencies: { fixture: "workspace:*" },
        },
        {
            name: "runtime",
            directory: "packages/runtime",
            dependencies: { provider: "workspace:*", external: "1.0" },
        },
        { name: "fixture", directory: "packages/fixture" },
        { name: "unrelated", directory: "packages/unrelated" },
    ];
    assert.deepEqual(runtimeClosure(inventory, ["provider"]), [
        "packages/agent",
        "packages/fixture",
        "packages/provider",
        "packages/runtime",
    ]);
    assert.throws(
        () => runtimeClosure(inventory.slice(1), ["provider"]),
        /Missing/,
    );
    inventory[0].dependencies.missing = "workspace:*";
    assert.throws(() => runtimeClosure(inventory, ["provider"]), /Unresolved/);
});

test("whole-package profiling measures chained process boundaries rather than overlapping assertion times", () => {
    const text = [
        "2026-11-05T00:00:00.0000000Z packages/a test:local$ jest && node layout",
        "2026-11-05T00:00:01.0000000Z packages/b test:local$ node --test",
        "2026-11-05T00:00:03.0000000Z packages/b test:local: Done",
        "2026-11-05T00:00:05.0000000Z packages/a test:local: Done",
    ].join("\n");
    assert.deepEqual(packageTimingsFromLog(text), {
        "packages/b": 2000,
        "packages/a": 5000,
    });

    test("node provider scopes retain the relative-path test agent and its dependencies", () => {
        const inventory = [
            {
                name: "dispatcher-node-providers",
                directory: "packages/dispatcher/nodeProviders",
            },
            {
                name: "test-agent",
                directory: "packages/agents/test",
                dependencies: { sdk: "workspace:*" },
            },
            { name: "sdk", directory: "packages/sdk" },
        ];
        assert.deepEqual(
            runtimeClosure(inventory, ["dispatcher-node-providers"]),
            [
                "packages/agents/test",
                "packages/dispatcher/nodeProviders",
                "packages/sdk",
            ],
        );
        assert.throws(
            () =>
                runtimeClosure(inventory.slice(0, 1), [
                    "dispatcher-node-providers",
                ]),
            /Missing workspace runtime dependency: test-agent/,
        );
    });
    assert.throws(
        () => packageTimingsFromLog(text.split("\n").slice(0, 3).join("\n")),
        /Incomplete/,
    );
    assert.throws(
        () => packageTimingsFromLog(text + "\nRETRYING 1 failed package"),
        /separately/,
    );
});

function reports() {
    return Object.entries(plans).flatMap(([platform, plan]) =>
        ["v24.22.1", "v26.12.1"].flatMap((node) =>
            plan.groups.map(({ files }, i) => ({
                sha,
                platform,
                node,
                group: String(i + 1),
                manifestHash: "b".repeat(64),
                workspaceHash: "b".repeat(64),
                plan: structuredClone(plan),
                packages: [...files],
                success: true,
                elapsedMs: 1000,
            })),
        ),
    );
}

test("remainder qualification requires every supported target, full script inventory and unique lane", () => {
    assert.equal(qualifyLanes(reports(), sha, plans).length, 6);
    const scoped = reports();
    scoped[0].manifestHash = "c".repeat(64);
    assert.equal(
        qualifyLanes(scoped, sha, plans).length,
        6,
        "Consumer-scoped hashes may differ while the producer provenance must match",
    );
    const changes = [
        (rows) => rows.pop(),
        (rows) => {
            rows[0].group = "2";
        },
        (rows) => {
            rows[0].success = false;
        },
        (rows) => {
            rows[0].workspaceHash = "c".repeat(64);
        },
        (rows) => {
            rows[0].packages.pop();
        },
        (rows) => {
            rows[0].plan.packages[0].scripts["test:local"] = "dropped launcher";
        },
        (rows) => {
            rows[0].sha = "d".repeat(40);
        },
    ];
    for (const change of changes) {
        const rows = reports();
        change(rows);
        assert.throws(() => qualifyLanes(rows, sha, plans));
    }
});

test("legacy Node-selection alias requires the same 18 lanes without accepting Node 22 substitutes", () => {
    const rows = reports();
    assert.equal(rows.length, 18);
    assert.equal(qualifyLanes(rows, sha, plans, "24-and-26").length, 6);
    assert.deepEqual(
        qualifyLanes(rows, sha, plans),
        qualifyLanes(rows, sha, plans, "24-and-26"),
    );
    assert.throws(() => qualifyLanes(rows.slice(1), sha, plans, "24-and-26"));
    const wrongNode = structuredClone(rows);
    wrongNode[0].node = "v22.23.4";
    assert.throws(() => qualifyLanes(wrongNode, sha, plans, "24-and-26"));
    assert.throws(() => qualifyLanes([...rows, wrongNode[0]], sha, plans));
});

test("explicit workspace/root phases cannot silently drop or duplicate phases", async () => {
    for (const phase of ["workspace", "scripts"]) {
        const calls = [];
        assert.equal(
            await runLocalTestPhases(
                () => {
                    calls.push("workspace");
                    return 1;
                },
                () => {
                    calls.push("scripts");
                    return 1;
                },
                phase,
            ),
            1,
        );
        assert.deepEqual(calls, [phase]);
    }
    await assert.rejects(
        () =>
            runLocalTestPhases(
                () => assert.fail(),
                () => assert.fail(),
                "typo",
            ),
        /TYPEAGENT_TEST_PHASE/,
    );
});

test("profiled root-unit extraction remains equivalent to the original short-circuit chain", () => {
    const { scripts } = JSON.parse(
        fs.readFileSync(
            new URL("../../../package.json", import.meta.url),
            "utf8",
        ),
    );
    assert.equal(
        scripts["test:local:scripts"],
        `${scripts["test:local:script-unit"]} && pnpm run test:memory-quality`,
    );
});

test("cache and transport experiments are off by default, pinned, and never skip build validation", () => {
    const read = (file) =>
        yaml.load(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
    const main = read("../../../../.github/workflows/build-ts.yml");
    const target = read("../../../../.github/workflows/ci-fanout-target.yml");
    for (const flag of ["fanout_build_cache", "fanout_compact_artifact"]) {
        assert.equal(main.on.workflow_dispatch.inputs[flag].default, false);
    }
    assert.deepEqual(
        main.on.workflow_dispatch.inputs.fanout_artifact_compression.options,
        ["0", "3", "6"],
    );
    const build = target.jobs.workspace_build;
    for (const group of ["1", "2", "3", "4"]) {
        assert.ok(
            build.steps.some((step) =>
                step.with?.name?.startsWith(`fanout-remainder-${group}-`),
            ),
        );
    }
    assert.equal(
        target.jobs.remainder.steps.find((step) =>
            step.name?.startsWith("Test duration-balanced"),
        ).env.TYPEAGENT_REMAINDER_ARTIFACT_SCOPE,
        "${{ inputs.compact_artifact && 'remainder' || 'workspace' }}",
    );
    const cache = build.steps.find((step) =>
        step.uses?.startsWith("actions/cache@"),
    );
    assert.equal(cache.if, "inputs.build_cache");
    assert.equal(cache.with["restore-keys"], undefined);
    assert.equal(cache.with.path, "${{ runner.temp }}/fanout-build-cache");
    assert.equal(
        build.steps.find((step) => step.run === "pnpm run build").if,
        undefined,
    );
    const setup = read("../../../../.github/actions/fanout-setup/action.yml");
    const install = setup.runs.steps.find((step) =>
        step.name?.startsWith("Install native"),
    ).run;
    assert.match(install, /\$attempt -le 3/);
    assert.match(install, /--frozen-lockfile --strict-peer-dependencies/);
    assert.match(install, /--force/);
    assert.match(install, /::warning::/);
    assert.match(install, /throw .*exhausted/);
    for (const workflow of [
        main,
        target,
        read("../../../../.github/workflows/ci-fanout-experiment.yml"),
    ]) {
        for (const job of Object.values(workflow.jobs)) {
            for (const step of job.steps ?? []) {
                if (step.uses && !step.uses.startsWith("./"))
                    assert.match(step.uses, /@[a-f0-9]{40}$/);
            }
        }
    }
});
