// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadScenarioCorpus, getScenarioCases } from "./macro-eval-corpus.mjs";
import { gradeDocumentTrial } from "./macro-eval-grade.mjs";
import { createCampaignPlan } from "./macro-eval-plan.mjs";
import { summarizeCampaign } from "./macro-eval-report.mjs";
import { runNativeEvaluation } from "./macro-eval-native.mjs";

const commands = new Set(["plan", "grade", "report", "native"]);
const valueOptions = new Set([
    "--corpus",
    "--input",
    "--output",
    "--mode",
    "--cases",
    "--repetitions",
    "--seed",
    "--root-model",
    "--runner-model",
    "--max-target-model-turns",
    "--max-duration-ms",
]);
const commandOptions = {
    plan: new Set([...valueOptions].filter((name) => name !== "--input")),
    grade: new Set(["--corpus", "--input", "--output"]),
    report: new Set(["--input", "--output"]),
    native: new Set([
        "--corpus",
        "--input",
        "--output",
        "--console-helper-dir",
        "--execute-live",
    ]),
};

export function parseMacroArguments(argv) {
    if (argv.length === 1 && argv[0] === "--help") return { help: true };
    const [command, ...args] = argv;
    if (!commands.has(command))
        throw new Error("Choose plan, grade, report or native");
    const options = { command };
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (
            !commandOptions[command].has(name) ||
            options[name] !== undefined ||
            value === undefined ||
            value.startsWith("--") ||
            !value.trim()
        )
            throw new Error(
                `Invalid, duplicate or unsupported option: ${name}`,
            );
        options[name] = value;
    }
    for (const name of ["--output"])
        if (!options[name]) throw new Error(`Required option: ${name}`);
    if (command !== "report" && !options["--corpus"])
        throw new Error("Required option: --corpus");
    if (command !== "plan" && !options["--input"])
        throw new Error("Required option: --input");
    if (command === "native") {
        if (!options["--console-helper-dir"])
            throw new Error("Required option: --console-helper-dir");
        if (
            options["--execute-live"] !== undefined &&
            !["true", "false"].includes(options["--execute-live"])
        )
            throw new Error("--execute-live must be true or false");
    }
    return options;
}

function planOptions(options) {
    return {
        mode: options["--mode"],
        caseIds: options["--cases"]?.split(","),
        repetitions: Number(options["--repetitions"]),
        seed: options["--seed"] === undefined ? NaN : Number(options["--seed"]),
        rootModel: options["--root-model"],
        runnerModel: options["--runner-model"],
        maxTargetModelTurns: Number(options["--max-target-model-turns"]),
        maxDurationMs: Number(options["--max-duration-ms"]),
    };
}

function evaluateCommand(options) {
    if (options.command === "report") {
        const input = JSON.parse(fs.readFileSync(options["--input"], "utf8"));
        if (!input.plan || !Array.isArray(input.results))
            throw new Error("Report input requires plan and results");
        return summarizeCampaign(input.plan, input.results, input.preparation);
    }
    const corpus = loadScenarioCorpus(options["--corpus"]);
    const cases = getScenarioCases(corpus);
    const corpusHash = createHash("sha256")
        .update(JSON.stringify(corpus))
        .digest("hex");
    if (options.command === "plan")
        return {
            ...createCampaignPlan(cases, planOptions(options)),
            corpusHash,
        };
    const input = JSON.parse(fs.readFileSync(options["--input"], "utf8"));
    const scenario = cases.find((item) => item.id === input.scenarioId);
    if (!scenario) throw new Error(`Unknown scenario: ${input.scenarioId}`);
    return {
        scenarioId: scenario.id,
        corpusHash,
        grade: gradeDocumentTrial({
            ...input,
            scenario,
            documents: corpus.documents,
        }),
    };
}

export async function main(argv = process.argv.slice(2)) {
    const options = parseMacroArguments(argv);
    if (options.help) {
        process.stdout.write(
            "macro-eval.mjs plan|grade|report|native --output <new-path> [options]\n" +
                "plan/grade/report and native preflight are offline; live native requires --execute-live true.\n" +
                "plan: --corpus --mode --cases --repetitions --seed --root-model " +
                "--runner-model --max-target-model-turns --max-duration-ms\n" +
                "grade: --corpus --input <native-evidence.json>\n" +
                "report: --input <campaign.json>\n" +
                "native: --corpus --input <native-config.json> --console-helper-dir <scripts> " +
                "[--execute-live true] --output <fresh-owned-directory>\n",
        );
        return;
    }
    const output = path.resolve(options["--output"]);
    if (fs.existsSync(output))
        throw new Error(`Output must not already exist: ${output}`);
    if (options.command === "native") {
        const abort = new AbortController();
        const cancel = () => abort.abort();
        process.once("SIGINT", cancel);
        process.once("SIGTERM", cancel);
        try {
            const result = await runNativeEvaluation({
                corpus: loadScenarioCorpus(options["--corpus"]),
                config: JSON.parse(fs.readFileSync(options["--input"], "utf8")),
                output,
                helperDirectory: options["--console-helper-dir"],
                executeLive: options["--execute-live"] === "true",
                signal: abort.signal,
            });
            process.stdout.write(
                JSON.stringify({
                    command: "native",
                    output,
                    status: result.status,
                }) + "\n",
            );
            if (
                !["passed", "passed-attribution-only", "unexecuted"].includes(
                    result.status,
                )
            )
                process.exitCode = 1;
        } finally {
            process.removeListener("SIGINT", cancel);
            process.removeListener("SIGTERM", cancel);
        }
        return;
    }
    const result = evaluateCommand(options);
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
    });
    process.stdout.write(
        JSON.stringify({
            command: options.command,
            output,
            status:
                result.acceptance ??
                result.grade?.status ??
                (result.complete ? "report-complete" : "report-incomplete"),
        }) + "\n",
    );
    if (result.grade && result.grade.status !== "passed") {
        console.error(
            `Macro trial ${result.scenarioId}: ${result.grade.status}; ` +
                result.grade.errors.join("; "),
        );
        process.exitCode = 1;
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        await main();
    } catch (error) {
        console.error(`Macro evaluation failed: ${error.message}`);
        process.exitCode = 1;
    }
}
