// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

function category(frame) {
    const text = `${frame.functionName} ${frame.url}`;
    if (/performance-trace\.mjs/.test(text)) return "own-instrumentation";
    if (/garbage collector/.test(text)) return "gc";
    if (/idle/.test(text)) return "idle";
    if (/pako|fflate|zlib|inflate|deflate/i.test(text)) return "compression";
    if (/isomorphic-git|sha1|hash/i.test(text))
        return "git-object-traversal-or-hash";
    if (/viewHistory\.js/.test(text)) return "history-hydration-or-store";
    if (
        /fileMemoryService\.js|wikiConsolidation\.js|informationalView\.js/.test(
            text,
        )
    )
        return "host-eligibility-or-candidates";
    if (/harness\.mjs/.test(text)) return "harness-orchestration";
    return "other";
}

function indexProfile(profile) {
    assert.ok(
        Array.isArray(profile.nodes) &&
            Array.isArray(profile.samples) &&
            Array.isArray(profile.timeDeltas),
    );
    assert.equal(profile.samples.length, profile.timeDeltas.length);
    assert.ok(profile.endTime >= profile.startTime);
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map();
    for (const node of nodes.values())
        for (const id of node.children ?? []) {
            assert.ok(nodes.has(id), "Profile references missing child");
            parents.set(id, node.id);
        }
    return { nodes, parents };
}

function alignTargetWindows(profile, events) {
    const anchors = events.filter(
        (event) => event.event === "clock" && event.edge === "ANCHOR",
    );
    const anchorUs = anchors.map((event) =>
        Number(BigInt(event.monoNs) / 1000n),
    );
    const aligned =
        anchorUs.length >= 2 &&
        anchorUs.every(
            (time) => time >= profile.startTime && time <= profile.endTime,
        );
    const windows = [];
    const open = new Map();
    if (aligned)
        for (const event of events) {
            if (event.event !== "runner.target") continue;
            if (event.edge === "ENTER") open.set(event.id, event);
            if (["EXIT", "ERROR"].includes(event.edge) && open.has(event.id)) {
                const first = open.get(event.id);
                windows.push({
                    id: event.id,
                    jobId: first.jobId,
                    viewId: first.viewId,
                    startUs: Number(BigInt(first.monoNs) / 1000n),
                    endUs: Number(BigInt(event.monoNs) / 1000n),
                    sampledCategoriesMs: {},
                });
            }
        }
    return { aligned, anchorUs, windows };
}

function frameKey(frame) {
    return `${frame.url}:${frame.lineNumber}:${frame.columnNumber}:${frame.functionName}`;
}

function accumulateCallChain(id, ms, nodes, parents, ranks, paths) {
    const seen = new Set(),
        chain = [];
    let current = id;
    while (current !== undefined) {
        const node = nodes.get(current),
            frame = node.callFrame;
        const key = frameKey(frame);
        let rank = ranks.get(key);
        if (!rank) {
            rank = {
                ...frame,
                selfMs: 0,
                inclusiveMs: 0,
                samples: 0,
                positions: [],
            };
            ranks.set(key, rank);
        }
        if (current === id) {
            rank.selfMs += ms;
            rank.samples++;
        }
        if (!seen.has(key)) rank.inclusiveMs += ms;
        seen.add(key);
        chain.push(
            `${frame.functionName || "(anonymous)"}@${frame.url}:${frame.lineNumber + 1}`,
        );
        current = parents.get(current);
    }
    const key = chain.slice(0, 12).join(" <- ");
    const item = paths.get(key) ?? { chain: key, selfMs: 0, samples: 0 };
    item.selfMs += ms;
    item.samples++;
    paths.set(key, item);
}

function accumulateTargetWeights(windows, startUs, endUs, kind) {
    for (const window of windows) {
        const overlap =
            Math.max(
                0,
                Math.min(endUs, window.endUs) -
                    Math.max(startUs, window.startUs),
            ) / 1000;
        if (overlap)
            window.sampledCategoriesMs[kind] =
                (window.sampledCategoriesMs[kind] ?? 0) + overlap;
    }
}

export function analyzeProfile(profile, events = []) {
    const { nodes, parents } = indexProfile(profile);
    const { aligned, anchorUs, windows } = alignTargetWindows(profile, events);
    const ranks = new Map(),
        categories = {},
        paths = new Map();
    let cursor = profile.startTime,
        sampledMs = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const id = profile.samples[i],
            delta = profile.timeDeltas[i];
        assert.ok(nodes.has(id) && Number.isFinite(delta) && delta >= 0);
        const startUs = cursor;
        cursor += delta;
        const ms = delta / 1000;
        sampledMs += ms;
        const leaf = nodes.get(id),
            kind = category(leaf.callFrame);
        categories[kind] = (categories[kind] ?? 0) + ms;
        accumulateCallChain(id, ms, nodes, parents, ranks, paths);
        accumulateTargetWeights(windows, startUs, cursor, kind);
    }
    for (const node of nodes.values()) {
        const frame = node.callFrame;
        const key = frameKey(frame);
        ranks.get(key)?.positions.push(...(node.positionTicks ?? []));
    }
    const activeSampleMs = sampledMs - (categories.idle ?? 0);
    const ranking = [...ranks.values()].map((item) => ({
        ...item,
        sampledActivePercent: activeSampleMs
            ? (item.selfMs / activeSampleMs) * 100
            : 0,
    }));
    return {
        sampleCount: profile.samples.length,
        sampledMs,
        activeSampleMs,
        profileStartUs: profile.startTime,
        profileEndUs: profile.endTime,
        lastSampleUs: cursor,
        clockAlignment: {
            supported: aligned,
            anchorUs,
            explanation: aligned
                ? "Both same-child hrtime anchors bracketed by V8 monotonic profile; native artifact control validates domain. Window weights are whole-main-thread during target intervals, not exclusive async-target CPU."
                : "Clock domains not verified; only whole-process sampled weights reported.",
        },
        categories,
        targets: windows,
        rankedSelf: ranking.sort((a, b) => b.selfMs - a.selfMs).slice(0, 25),
        rankedInclusive: [...ranking]
            .sort((a, b) => b.inclusiveMs - a.inclusiveMs)
            .slice(0, 20),
        leafCallChains: [...paths.values()]
            .sort((a, b) => b.selfMs - a.selfMs)
            .slice(0, 15),
        limitations:
            "V8 main-thread sampled time is not process.cpuUsage across native worker threads. Inclusive weights overlap; idle is excluded only from active denominator. No exact JSON.parse versus enclosing hydration attribution without position evidence.",
    };
}

async function mapFrame(frame) {
    if (!frame.url || frame.url.startsWith("node:"))
        return { status: "NO_FILE_MAP" };
    const file = frame.url.startsWith("file:")
        ? fileURLToPath(frame.url)
        : frame.url;
    if (!path.isAbsolute(file)) return { status: "NO_ABSOLUTE_FILE" };
    let data;
    try {
        data = await readFile(`${file}.map`, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return { status: "NO_EXISTING_MAP" };
        throw error;
    }
    const map = new SourceMap(JSON.parse(data));
    return {
        status: "EXISTING_MAP",
        function: map.findEntry(frame.lineNumber, frame.columnNumber),
        hottestPositions: [...frame.positions]
            .sort((a, b) => b.ticks - a.ticks)
            .slice(0, 3)
            .map((position) => ({
                ...position,
                original: map.findEntry(position.line - 1, 0),
            })),
    };
}

export async function analyzeDirectory(root) {
    const profile = JSON.parse(
        await readFile(path.join(root, "native.cpu.cpuprofile"), "utf8"),
    );
    const events = (
        await readFile(path.join(root, "performance-events.jsonl"), "utf8")
    )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const result = analyzeProfile(profile, events);
    for (const frame of result.rankedSelf)
        frame.sourceMap = await mapFrame(frame);
    for (const frame of result.rankedInclusive)
        frame.sourceMap = await mapFrame(frame);
    await writeFile(
        path.join(root, "native-profile-analysis.json"),
        JSON.stringify(result, null, 2),
    );
    return result;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({ options: { run: { type: "string" } } });
    assert.ok(
        values.run && path.isAbsolute(values.run),
        "--run requires exact absolute owned artifact directory",
    );
    const result = await analyzeDirectory(values.run);
    process.stdout.write(
        `${JSON.stringify(
            {
                pid: process.pid,
                sampleCount: result.sampleCount,
                categories: result.categories,
                alignment: result.clockAlignment,
                topSelf: result.rankedSelf
                    .slice(0, 8)
                    .map(
                        ({
                            functionName,
                            url,
                            selfMs,
                            sampledActivePercent,
                            sourceMap,
                        }) => ({
                            functionName,
                            url,
                            selfMs,
                            sampledActivePercent,
                            sourceMap,
                        }),
                    ),
                output: path.join(values.run, "native-profile-analysis.json"),
            },
            null,
            2,
        )}\n`,
    );
}
