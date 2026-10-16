// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import {
    analyzeProfile,
    analyzeDirectory,
} from "./native-profile-analysis.mjs";

test("native analyzer rejects malformed samples and never invents clock alignment", () => {
    const profile = {
        startTime: 1000,
        endTime: 4000,
        nodes: [
            {
                id: 1,
                callFrame: {
                    functionName: "(root)",
                    url: "",
                    lineNumber: 0,
                    columnNumber: 0,
                },
                children: [2],
            },
            {
                id: 2,
                callFrame: {
                    functionName: "leaf",
                    url: "file:///control.js",
                    lineNumber: 1,
                    columnNumber: 0,
                },
            },
        ],
        samples: [2, 2],
        timeDeltas: [1000, 1000],
    };
    const result = analyzeProfile(profile);
    assert.equal(result.clockAlignment.supported, false);
    assert.equal(result.rankedSelf[0].selfMs, 2);
    assert.equal(result.rankedInclusive[0].inclusiveMs, 2);
    assert.deepEqual(result.targets, []);
    assert.throws(() => analyzeProfile({ ...profile, samples: [99, 2] }));
    assert.throws(() => analyzeProfile({ ...profile, timeDeltas: [1000] }));
    assert.throws(() => analyzeProfile({ ...profile, timeDeltas: [-1, 1000] }));
    assert.throws(() =>
        analyzeProfile({ ...profile, timeDeltas: [NaN, 1000] }),
    );
    assert.throws(() => analyzeProfile({ ...profile, endTime: 0 }));
    assert.throws(() =>
        analyzeProfile({
            ...profile,
            nodes: [{ ...profile.nodes[0], children: [99] }],
        }),
    );
});

test("native analyzer preserves recursive ranks and overlapping main-thread target weights", () => {
    const frame = {
        functionName: "inflate",
        url: "file:///control.js",
        lineNumber: 1,
        columnNumber: 0,
    };
    const profile = {
        startTime: 1000,
        endTime: 5000,
        nodes: [
            {
                id: 1,
                callFrame: frame,
                children: [2],
                positionTicks: [{ line: 2, ticks: 1 }],
            },
            {
                id: 2,
                callFrame: frame,
                positionTicks: [{ line: 2, ticks: 2 }],
            },
            { id: 3, callFrame: { ...frame, functionName: "(idle)" } },
        ],
        samples: [2, 3],
        timeDeltas: [2000, 2000],
    };
    const targetEvent = (id, edge, us) => ({
        event: "runner.target",
        id,
        edge,
        jobId: `job-${id}`,
        viewId: `view-${id}`,
        monoNs: String(us * 1000),
    });
    const events = [
        { event: "clock", edge: "ANCHOR", monoNs: "1000000" },
        targetEvent("a", "ENTER", 2000),
        targetEvent("b", "ENTER", 2500),
        targetEvent("a", "EXIT", 4000),
        targetEvent("b", "ERROR", 4500),
        targetEvent("unfinished", "ENTER", 4500),
        targetEvent("unopened", "EXIT", 4500),
        { event: "clock", edge: "ANCHOR", monoNs: "5000000" },
    ];
    const result = analyzeProfile(profile, events);
    assert.equal(result.clockAlignment.supported, true);
    assert.deepEqual(result.clockAlignment.anchorUs, [1000, 5000]);
    assert.equal(result.sampledMs, 4);
    assert.equal(result.activeSampleMs, 2);
    assert.equal(result.lastSampleUs, 5000);
    assert.deepEqual(result.categories, { compression: 2, idle: 2 });
    assert.deepEqual(result.targets, [
        {
            id: "a",
            jobId: "job-a",
            viewId: "view-a",
            startUs: 2000,
            endUs: 4000,
            sampledCategoriesMs: { compression: 1, idle: 1 },
        },
        {
            id: "b",
            jobId: "job-b",
            viewId: "view-b",
            startUs: 2500,
            endUs: 4500,
            sampledCategoriesMs: { compression: 0.5, idle: 1.5 },
        },
    ]);
    const recursive = result.rankedSelf.find(
        (rank) => rank.functionName === "inflate",
    );
    assert.equal(recursive.selfMs, 2);
    assert.equal(recursive.inclusiveMs, 2);
    assert.equal(recursive.samples, 1);
    assert.equal(recursive.sampledActivePercent, 100);
    assert.deepEqual(recursive.positions, [
        { line: 2, ticks: 1 },
        { line: 2, ticks: 2 },
    ]);
    assert.match(result.leafCallChains[0].chain, /inflate.* <- inflate/);
    assert.deepEqual(analyzeProfile(profile, events.slice(1)).targets, []);
    assert.equal(
        analyzeProfile(profile, [
            ...events,
            { event: "clock", edge: "ANCHOR", monoNs: "9000000" },
        ]).clockAlignment.supported,
        false,
    );
});

test(
    "actual normal native child exit flushes profile, validates clocks and preserves complete artifact",
    { timeout: 20000 },
    async () => {
        const root = await mkdtemp(
            path.join(
                process.env.QUALIFICATION_ARTIFACTS ?? process.cwd(),
                "memory-native-artifact-control-",
            ),
        );
        const script = `
        const fs = require('node:fs');
        const anchors = [];
        const mark = () => anchors.push({ event:'clock', edge:'ANCHOR', monoNs:process.hrtime.bigint().toString() });
        mark();
        function controlCpuLeaf() { const until = Date.now() + 300; let n = 0; while (Date.now() < until) n += Math.sqrt(n + 1); return n; }
        controlCpuLeaf(); mark();
        fs.writeFileSync(${JSON.stringify(path.join(root, "performance-events.jsonl"))}, anchors.map(x=>JSON.stringify(x)).join('\\n')+'\\n');
    `;
        const child = spawn(
            process.execPath,
            [
                "--cpu-prof",
                "--cpu-prof-interval=10000",
                `--cpu-prof-dir=${root}`,
                "--cpu-prof-name=native.cpu.cpuprofile",
                "-e",
                script,
            ],
            { stdio: ["ignore", "ignore", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        const exit = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code, signal) => resolve({ code, signal }));
        });
        await writeFile(
            path.join(root, "native-control-ownership.json"),
            JSON.stringify({ pid: child.pid, exit, root }),
        );
        assert.equal(exit.code, 0, stderr);
        const result = await analyzeDirectory(root);
        assert.ok(result.sampleCount > 5);
        assert.equal(result.clockAlignment.supported, true);
        assert.ok(
            result.rankedSelf.some(
                (frame) => frame.functionName === "controlCpuLeaf",
            ),
        );
        const raw = JSON.parse(
            await readFile(path.join(root, "native.cpu.cpuprofile"), "utf8"),
        );
        assert.equal(raw.samples.length, result.sampleCount);
        process.stdout.write(
            `Native artifact control PID${child.pid} exited0: ${root}\n`,
        );
    },
);
