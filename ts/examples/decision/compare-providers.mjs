import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cases as mcpCases } from "./mcp/fixtures.mjs";
import { cases as dispatcherCases } from "./dispatcher/fixtures.mjs";
import { cases as retrievalCases } from "./retrieval/fixtures.mjs";
import { cases as verificationCases } from "./verification/fixtures.mjs";
import { cases as workflowCases } from "./workflow/fixtures.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const scenarios = [
    ["primitives", "main.mjs", ["--jsonl"], 7],
    ["mcp", "mcp/main.mjs", [], mcpCases.length],
    ["dispatcher", "dispatcher/main.mjs", [], dispatcherCases.length],
    ["retrieval", "retrieval/rerank.mjs", [], retrievalCases.length],
    ["verification", "verification/verify.mjs", [], verificationCases.length],
    ["workflow", "workflow/advise.mjs", [], workflowCases.length],
    ["shopping", "web-shopping/run.mjs", ["--limit", "2"], 2],
    ["crossword", "crossword/run.mjs", ["--limit", "2"], 2],
    ...["read", "fill", "crossing", "conflict"].map((scenario) => [
        `crossword-2-${scenario}`,
        "crossword-2/run.mjs",
        ["--scenario", scenario],
        scenario === "fill" ? 1 : 2,
    ]),
    ["shopping-hybrid", "web-shopping-hybrid/run.mjs", ["--limit", "2"], 2],
    ["commerce", "webmcp-commerce/main.mjs", ["--limit", "1"], 1],
    ["commerce-hybrid", "webmcp-commerce/hybrid.mjs", ["--limit", "1"], 1],
];

export function comparisonJobs(values = {}) {
    const providers = [
        { id: "copilot", provider: "copilot", model: "gpt-6-luna-decisions" },
        {
            id: "azure-eastus",
            provider: "azure",
            region: "eastus",
            model: "decision-1",
        },
        {
            id: "azure-swedencentral",
            provider: "azure",
            region: "swedencentral",
            model: "decision-1",
        },
    ];
    const variants = values.live ? providers : [{ id: "offline" }];
    const jobs = variants.flatMap((variant) =>
        scenarios.map(([scenario, file, extra, plannedCases]) => {
            const args = [join(directory, file), ...extra];
            const hybrid = scenario.endsWith("hybrid");
            if (values.live) {
                if (scenario !== "primitives") args.push("--live");
                args.push(
                    "--provider",
                    variant.provider,
                    "--model",
                    variant.model,
                );
                if (variant.region) args.push("--region", variant.region);
                if (
                    values["cli-path"] &&
                    (variant.provider === "copilot" || hybrid)
                )
                    args.push("--cli-path", values["cli-path"]);
                if (hybrid)
                    args.push(
                        "--chat-model",
                        values["chat-model"] ?? "gpt-5-mini",
                    );
            } else if (scenario === "primitives") {
                args.push(
                    "--dry-run",
                    "--provider",
                    "azure",
                    "--model",
                    "decision-1",
                    "--region",
                    "eastus",
                );
            }
            return {
                ...variant,
                id: `${variant.id}-${scenario}`,
                scenario,
                plannedCases,
                args,
            };
        }),
    );
    const args = [
        join(directory, "web-shopping-generative/run.mjs"),
        "--limit",
        "2",
    ];
    if (values.live) {
        args.push(
            "--live",
            "--chat-model",
            values["chat-model"] ?? "gpt-5-mini",
        );
        if (values["cli-path"]) args.push("--cli-path", values["cli-path"]);
    }
    jobs.push({
        id: "generative-shopping-control",
        scenario: "shopping-generative",
        provider: "copilot-chat",
        plannedCases: 2,
        args,
    });
    return jobs;
}

async function sourceHashes(root = directory, prefix = "") {
    const hashes = {};
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (["node_modules", "results"].includes(entry.name)) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory())
            Object.assign(
                hashes,
                await sourceHashes(join(root, entry.name), relative + "/"),
            );
        else if (
            /\.(mjs|html|svg)$/.test(entry.name) ||
            relative === "package.json"
        )
            hashes[relative] = createHash("sha256")
                .update(await readFile(join(root, entry.name)))
                .digest("hex");
    }
    return hashes;
}

function execute(job) {
    return new Promise((resolveRun) => {
        const started = performance.now();
        const child = spawn(process.execPath, job.args, {
            cwd: directory,
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 600_000,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            stderr += `\n${error.code ?? "child_process_error"}`;
        });
        child.on("close", (exitCode, signal) =>
            resolveRun({
                stdout,
                stderr,
                exitCode,
                signal,
                elapsedMs: Math.round(performance.now() - started),
            }),
        );
    });
}

export async function collect(values) {
    const jobs = comparisonJobs(values);
    const preview = {
        live: Boolean(values.live),
        jobs,
        plannedCases: jobs.reduce((total, job) => total + job.plannedCases, 0),
    };
    if (values["dry-run"]) return preview;
    if (!values["output-dir"])
        throw new Error("--output-dir must be a fresh directory.");
    const output = resolve(values["output-dir"]);
    await mkdir(dirname(output), { recursive: true });
    await mkdir(output);
    const manifest = {
        ...preview,
        started: new Date().toISOString(),
        sourceHashes: await sourceHashes(),
        benchmark: false,
        recordings: false,
        excluded: [
            "Stagehand native/rerank unavailable",
            "Decision-1 is not a generative-only model",
            "Embedding and generative judge baselines not implemented",
            "Commerce keeps its existing single-live-case cap",
        ],
        results: [],
    };
    const checkpoint = () =>
        writeFile(
            join(output, "manifest.json"),
            JSON.stringify(manifest, null, 2) + "\n",
        );
    await checkpoint();
    for (const job of jobs) {
        process.stdout.write(`${job.id}: starting\n`);
        const run = await execute(job);
        await writeFile(join(output, `${job.id}.stdout.jsonl`), run.stdout);
        await writeFile(join(output, `${job.id}.stderr.txt`), run.stderr);
        const { stdout, stderr, ...result } = run;
        manifest.results.push({
            id: job.id,
            ...result,
            stdoutHash: createHash("sha256").update(stdout).digest("hex"),
            stderrHash: createHash("sha256").update(stderr).digest("hex"),
        });
        await checkpoint();
        process.stdout.write(
            `${job.id}: exit ${run.exitCode}, ${run.elapsedMs}ms\n`,
        );
    }
    manifest.finished = new Date().toISOString();
    await checkpoint();
    return {
        output,
        jobs: jobs.length,
        nonzeroExits: manifest.results.filter(({ exitCode }) => exitCode !== 0)
            .length,
    };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const { values } = parseArgs({
        options: {
            live: { type: "boolean", default: false },
            "dry-run": { type: "boolean", default: false },
            "output-dir": { type: "string" },
            "cli-path": { type: "string" },
            "chat-model": { type: "string", default: "gpt-5-mini" },
        },
    });
    collect(values)
        .then((result) => process.stdout.write(JSON.stringify(result) + "\n"))
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}
