import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("./", import.meta.url));

export const scenarios = [
    {
        id: "decision-shopping-filter",
        runner: "web-shopping/run.mjs",
        limit: 1,
    },
    {
        id: "decision-shopping-details",
        runner: "web-shopping/run.mjs",
        limit: 2,
    },
    {
        id: "generative-shopping-filter",
        runner: "web-shopping-generative/run.mjs",
        limit: 1,
    },
    {
        id: "generative-shopping-details",
        runner: "web-shopping-generative/run.mjs",
        limit: 2,
    },
    {
        id: "hybrid-shopping-filter",
        runner: "web-shopping-hybrid/run.mjs",
        limit: 1,
    },
    {
        id: "hybrid-shopping-details",
        runner: "web-shopping-hybrid/run.mjs",
        limit: 2,
    },
    { id: "crossword-read", runner: "crossword/run.mjs", limit: 1 },
    { id: "crossword-fill", runner: "crossword/run.mjs", limit: 2 },
];

export function options(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            "output-dir": { type: "string" },
            live: { type: "boolean", default: false },
            "dry-run": { type: "boolean", default: false },
            "cli-path": { type: "string" },
            "chat-model": { type: "string", default: "gpt-5-mini" },
        },
    });
    if (!values["output-dir"]?.trim())
        throw new Error("--output-dir is required");
    return values;
}

export function runnerArguments(scenario, values) {
    const args = [
        join(root, scenario.runner),
        "--limit",
        String(scenario.limit),
    ];
    if (values.live) args.push("--live");
    if (values["cli-path"]) args.push("--cli-path", values["cli-path"]);
    if (
        scenario.id.startsWith("generative-") ||
        scenario.id.startsWith("hybrid-")
    )
        args.push("--chat-model", values["chat-model"]);
    args.push(
        "--demo",
        "--record-dir",
        join(resolve(values["output-dir"]), scenario.id),
    );
    return args;
}

async function sourceHashes() {
    const files = [
        "record-demos.mjs",
        "decision.mjs",
        "web-shopping/browser.mjs",
        "web-shopping/run.mjs",
        "web-shopping/observer.mjs",
        "web-shopping/fixture.html",
        "crossword/run.mjs",
        "crossword/crossword.mjs",
        "crossword/fixture.html",
        "generative/client.mjs",
        "web-shopping-generative/run.mjs",
        "web-shopping-generative/selection.mjs",
        "web-shopping-hybrid/run.mjs",
        "web-shopping-hybrid/selection.mjs",
    ];
    const hashes = {};
    for (const file of files)
        hashes[file] = createHash("sha256")
            .update(await readFile(join(root, file)))
            .digest("hex");
    return hashes;
}

async function recordScenario(scenario, values, directory) {
    const startedAt = new Date().toISOString();
    const result = spawnSync(
        process.execPath,
        runnerArguments(scenario, values),
        {
            cwd: root,
            encoding: "utf8",
            timeout: 180000,
            maxBuffer: 4 * 1024 * 1024,
        },
    );
    let evidence;
    try {
        evidence = JSON.parse(
            await readFile(
                join(directory, scenario.id, "evidence.json"),
                "utf8",
            ),
        );
    } catch {
        evidence = undefined;
    }
    const entry = {
        ...scenario,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: result.status,
        status:
            result.status === 0 && evidence?.status === "passed"
                ? "scenario-verified"
                : "failed",
        mode: evidence?.mode,
        decisionModelCalls: evidence?.decisionModelCalls ?? 0,
        generativeModelCalls: evidence?.generativeModelCalls ?? 0,
        cases: evidence?.cases,
        rawVideo: `${scenario.id}/scenario.webm`,
        evidence: `${scenario.id}/evidence.json`,
        mediaValidated: false,
    };
    if (result.error) entry.reason = "runner_process_failed";
    process.stdout.write(`${scenario.id}: ${entry.status}\n`);
    return entry;
}

export async function recordAll(values = options()) {
    const directory = resolve(values["output-dir"]);
    if (values["dry-run"])
        return {
            status: "dry-run",
            recording: false,
            directory,
            live: values.live,
            scenarios,
        };
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory);
    const manifest = {
        startedAt: new Date().toISOString(),
        benchmark: false,
        audio: false,
        demoPaced: true,
        capture: "page-viewport",
        nodeVersion: process.version,
        requestedDecisionModel: values.live
            ? "gpt-6-luna-decisions"
            : undefined,
        requestedChatModel: values.live ? values["chat-model"] : undefined,
        sourceHashes: await sourceHashes(),
        scenarios: [],
    };
    for (const scenario of scenarios) {
        manifest.scenarios.push(
            await recordScenario(scenario, values, directory),
        );
        await writeFile(
            join(directory, "manifest.json"),
            JSON.stringify(manifest, null, 2) + "\n",
        );
    }
    manifest.finishedAt = new Date().toISOString();
    manifest.status = manifest.scenarios.every(
        (item) => item.status === "scenario-verified",
    )
        ? "scenario-verified"
        : "failed";
    await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
    );
    return manifest;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
    recordAll()
        .then((report) => {
            process.stdout.write(
                `${JSON.stringify({ status: report.status, scenarios: report.scenarios.length })}\n`,
            );
            if (!["scenario-verified", "dry-run"].includes(report.status))
                process.exitCode = 1;
        })
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
