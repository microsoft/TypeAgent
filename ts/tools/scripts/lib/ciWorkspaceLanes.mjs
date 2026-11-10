// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { fanoutNodes } from "./ciFanoutTargets.mjs";
import {
    balanceTests,
    partitionPackages,
    validatePartitions,
} from "./ciTestPartitions.mjs";

export const fullMacosHeavyPackages = [
    "agent-dispatcher",
    "default-agent-provider",
    "@typeagent/memory-service",
    "@typeagent/memory-mcp-server",
];

export function remainderPackages(packages) {
    const excluded = new Set([
        "@typeagent/memory-service",
        ...Object.values(partitionPackages).map(({ name }) => name),
    ]);
    const selected = packages.filter(
        (pkg) => pkg.scripts["test:local"] && !excluded.has(pkg.name),
    );
    assert.ok(selected.length >= 4, "Incomplete remainder package inventory");
    assert.equal(
        new Set(selected.map((pkg) => pkg.name)).size,
        selected.length,
        "Duplicate workspace package",
    );
    return selected.sort((a, b) => a.name.localeCompare(b.name));
}

export function validateLanePlan(plan) {
    assert.equal(plan.version, 1);
    assert.equal(
        new Set(plan.packages.map((pkg) => pkg.name)).size,
        plan.packages.length,
    );
    const names = plan.packages.map((pkg) => pkg.name).sort();
    if (plan.platform === "darwin" && !plan.fullMacos) {
        assert.equal(
            plan.groups.length,
            1,
            "macOS must retain one compatibility lane",
        );
        assert.deepEqual([...plan.groups[0].files].sort(), names);
    } else {
        assert.ok(["linux", "win32", "darwin"].includes(plan.platform));
        validatePartitions(names, plan.groups);
        if (plan.fullMacos) {
            assert.equal(plan.fullMacos, true);
            assert.equal(plan.platform, "darwin");
            for (const [index, group] of plan.groups.entries()) {
                assert.deepEqual(
                    group.files.filter((name) =>
                        fullMacosHeavyPackages.includes(name),
                    ),
                    [fullMacosHeavyPackages[index]],
                    "Each full macOS lane must retain exactly one heavy package",
                );
            }
        }
    }
}

export function planLanes(
    packages,
    timings,
    platform,
    compatibilityDirectories,
    fullMacos = false,
) {
    assert.equal(typeof fullMacos, "boolean");
    if (fullMacos) assert.equal(platform, "darwin");
    const compatibility = platform === "darwin" && !fullMacos;
    const selected = fullMacos
        ? packages
              .filter((pkg) => pkg.scripts["test:local"])
              .sort((a, b) => a.name.localeCompare(b.name))
        : compatibility
          ? packages.filter((pkg) =>
                compatibilityDirectories.includes(pkg.directory),
            )
          : remainderPackages(packages);
    const names = selected.map((pkg) => pkg.name).sort();
    const balanced = compatibility
        ? { groups: [{ files: names }], unprofiled: [], fallbackMs: 0 }
        : balanceTests(
              fullMacos
                  ? names.filter(
                        (name) => !fullMacosHeavyPackages.includes(name),
                    )
                  : names,
              timings,
          );
    if (fullMacos) {
        for (const [index, name] of fullMacosHeavyPackages.entries()) {
            assert.ok(
                names.includes(name),
                `Missing full macOS package: ${name}`,
            );
            balanced.groups[index].files.unshift(name);
            balanced.groups[index].estimatedMs +=
                timings[name] ?? balanced.fallbackMs;
            if (timings[name] === undefined) balanced.unprofiled.push(name);
        }
        balanced.unprofiled.sort();
    }
    const plan = {
        version: 1,
        platform,
        ...(fullMacos ? { fullMacos: true } : {}),
        packages: selected.map(({ name, directory, scripts }) => ({
            name,
            directory,
            scripts,
        })),
        groups: balanced.groups,
        unprofiled: balanced.unprofiled,
        fallbackMs: balanced.fallbackMs,
    };
    if (compatibility) {
        assert.deepEqual(
            selected.map((pkg) => pkg.directory).sort(),
            [...compatibilityDirectories].sort(),
            "Incomplete macOS compatibility inventory",
        );
    }
    validateLanePlan(plan);
    return plan;
}

export function runtimeClosure(packages, initialNames) {
    const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
    assert.equal(byName.size, packages.length, "Duplicate workspace package");
    const visited = new Set();
    const pending = [...initialNames];
    while (pending.length) {
        const name = pending.pop();
        if (visited.has(name)) continue;
        const pkg = byName.get(name);
        assert.ok(pkg, `Missing workspace runtime dependency: ${name}`);
        visited.add(name);
        // Provider tests load this fixture by relative path, outside package metadata.
        if (name === "dispatcher-node-providers") pending.push("test-agent");
        for (const [dependency, version] of Object.entries({
            ...pkg.dependencies,
            ...pkg.optionalDependencies,
            ...pkg.devDependencies,
        })) {
            if (byName.has(dependency)) pending.push(dependency);
            else
                assert.ok(
                    !version.startsWith("workspace:"),
                    `Unresolved workspace dependency: ${dependency}`,
                );
        }
    }
    return [...visited].map((name) => byName.get(name).directory).sort();
}

export function packageTimingsFromLog(text) {
    assert.doesNotMatch(
        text,
        /RETRYING \d+ failed/,
        "Profile first-pass logs separately from retries",
    );
    const starts = new Map();
    const timings = {};
    for (const line of text.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
        const match =
            /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s+((?:packages|examples|extensions|tools)\/[\w./-]+) test:local(?:(\$)|: (Done|Failed))/.exec(
                line,
            );
        if (!match) continue;
        const [, timestamp, directory, start] = match;
        const time = Date.parse(timestamp);
        if (start) starts.set(directory, time);
        else {
            assert.ok(starts.has(directory), `Missing start: ${directory}`);
            const ms = time - starts.get(directory);
            assert.ok(
                Number.isFinite(ms) && ms > 0,
                "Invalid hosted package timing",
            );
            timings[directory] = Math.max(timings[directory] ?? 0, ms);
            starts.delete(directory);
        }
    }
    assert.equal(starts.size, 0, "Incomplete package process timings");
    assert.ok(Object.keys(timings).length > 0, "No package timings found");
    return timings;
}

export function qualifyLanes(reports, sha, plans, fullMacos = false) {
    const nodes = fanoutNodes();
    const platforms = fullMacos ? ["darwin"] : ["linux", "win32", "darwin"];
    assert.deepEqual(Object.keys(plans).sort(), [...platforms].sort());
    assert.equal(
        reports.length,
        nodes.length *
            Object.values(plans).reduce(
                (count, plan) => count + plan.groups.length,
                0,
            ),
        "Expected every full remainder and macOS compatibility lane for selected Nodes",
    );
    const summary = [];
    for (const platform of platforms) {
        const plan = plans[platform];
        assert.equal(plan.fullMacos === true, fullMacos);
        validateLanePlan(plan);
        for (const node of nodes) {
            const selected = reports.filter(
                (report) =>
                    report.platform === platform && report.node === node,
            );
            assert.deepEqual(
                selected.map((report) => report.group).sort(),
                plan.groups.map((_, i) => String(i + 1)),
            );
            for (const report of selected) {
                assert.equal(report.sha, sha);
                assert.equal(report.success, true, "Failed remainder lane");
                assert.match(report.manifestHash, /^[a-f0-9]{64}$/);
                assert.match(report.workspaceHash, /^[a-f0-9]{64}$/);
                assert.equal(
                    report.workspaceHash,
                    selected[0].workspaceHash,
                    "Mixed remainder artifacts",
                );
                assert.deepEqual(
                    report.plan,
                    plan,
                    "Remainder script or inventory drift",
                );
                assert.deepEqual(
                    report.packages,
                    plan.groups[Number(report.group) - 1].files,
                );
                assert.ok(
                    Number.isFinite(report.elapsedMs) && report.elapsedMs > 0,
                );
            }
            summary.push({
                platform,
                node,
                packages: plan.packages.length,
                slowestMs: Math.max(
                    ...selected.map((report) => report.elapsedMs),
                ),
            });
        }
    }
    return summary;
}
