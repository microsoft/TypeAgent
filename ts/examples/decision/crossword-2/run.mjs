import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { openBrowser } from "../web-shopping/browser.mjs";
import { decisionClient } from "../web-shopping/run.mjs";
import { createCrosswordActions } from "./crossword.mjs";
import { startCrosswordFixture, revision } from "./fixture.mjs";

export const scenarios = {
    read: [
        { action: "getClueValue", number: 1, direction: "across" },
        { action: "getClueValue", number: 1, direction: "down" },
    ],
    fill: [
        { action: "enterText", number: 1, direction: "across", value: "laser" },
    ],
    crossing: [
        { action: "enterText", number: 1, direction: "across", value: "laser" },
        { action: "enterText", number: 1, direction: "down", value: "later" },
    ],
    conflict: [
        { action: "enterText", number: 1, direction: "across", value: "laser" },
        {
            action: "enterText",
            number: 1,
            direction: "down",
            value: "water",
            expectedError: "crossing_conflict",
        },
    ],
};

export function options(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            scenario: { type: "string", default: "crossing" },
            live: { type: "boolean", default: false },
            "dry-run": { type: "boolean", default: false },
            "record-dir": { type: "string" },
            demo: { type: "boolean", default: false },
            "cli-path": { type: "string" },
            model: { type: "string", default: "gpt-6-luna-decisions" },
        },
    });
    if (!Object.hasOwn(scenarios, values.scenario))
        throw new Error("invalid_scenario");
    if (values.demo && !values["record-dir"])
        throw new Error("demo_requires_record_directory");
    if (values.live && values["dry-run"])
        throw new Error("dry_run_cannot_be_live");
    return values;
}

async function executeStep(actions, step) {
    try {
        const result =
            step.action === "getClueValue"
                ? await actions.getClueValue(step.number, step.direction)
                : await actions.enterText(
                      step.value,
                      step.number,
                      step.direction,
                  );
        if (step.expectedError)
            return {
                status: "failed_closed",
                reason: "expected_rejection_did_not_occur",
            };
        return { status: "passed", result };
    } catch (error) {
        return {
            status:
                error.message === step.expectedError
                    ? "expected_rejection"
                    : "failed_closed",
            reason: error.message,
        };
    }
}

async function sourceHashes() {
    const result = {};
    for (const file of [
        "crossword.mjs",
        "fixture.mjs",
        "fixture.html",
        "puzzle.mjs",
        "run.mjs",
    ])
        result[file] = createHash("sha256")
            .update(await readFile(new URL(file, import.meta.url)))
            .digest("hex");
    return result;
}

export async function runCrossword(values = options()) {
    const steps = scenarios[values.scenario];
    if (values["dry-run"]) {
        const preview = {
            lane: "crossword-2",
            mode: "dry-run",
            scenario: values.scenario,
            steps,
            maximumSelectorCalls: steps.length,
        };
        process.stdout.write(`${JSON.stringify(preview)}\n`);
        return preview;
    }
    const fixture = await startCrosswordFixture();
    let browser;
    let decisions;
    let selectorCalls = 0;
    const cases = [];
    const responses = [];
    const label = `Crossword 2 | 15x15 Exolve | ${values.live ? "Live decision model" : "Offline selector"} | Supplied answers${values.demo ? " | Demo paced, not benchmark" : ""}`;
    try {
        browser = await openBrowser({
            recordDirectory: values["record-dir"],
            demo: values.demo,
        });
        await browser.context.route("**/*", (route) =>
            route.request().url().startsWith(`${fixture.url}/`)
                ? route.continue()
                : route.abort(),
        );
        decisions = await decisionClient(values);
        await browser.page.goto(fixture.url);
        const actions = createCrosswordActions({
            ...browser,
            client: {
                async decide(...args) {
                    selectorCalls++;
                    const response = await decisions.client.decide(...args);
                    responses.push(response);
                    return response;
                },
            },
        });
        for (const step of steps) {
            await browser.caption(
                `${label}\n${step.action}(${step.value ? `${step.value}, ` : ""}${step.number}, ${step.direction})`,
            );
            const start = performance.now();
            const result = await executeStep(actions, step);
            cases.push({
                step,
                ...result,
                latencyMs: performance.now() - start,
                decision: responses.at(-1),
            });
            await browser.caption(
                `${label}\n${result.status}: ${result.reason ?? JSON.stringify(result.result)}`,
            );
            if (values["record-dir"])
                await browser.page.screenshot({
                    path: join(
                        values["record-dir"],
                        `case-${cases.length}.png`,
                    ),
                });
            if (values.demo) await browser.page.waitForTimeout(1200);
            if (result.status === "failed_closed") break;
        }
        const report = {
            lane: "crossword-2",
            scenario: values.scenario,
            status:
                cases.length === steps.length &&
                cases.every((item) => item.status !== "failed_closed")
                    ? "passed"
                    : "failed_closed",
            mode: values.live
                ? "live-decisions-local-exolve"
                : "offline-selector-local-exolve",
            renderer: {
                engine: "Exolve",
                revision,
                dimensions: [15, 15],
                clueCount: 36,
                solvedGridProvided: false,
            },
            cases,
            selectorCalls,
            decisionModelCalls: values.live ? selectorCalls : 0,
            explicitActModelCalls: 0,
            benchmark: false,
            sourceHashes: await sourceHashes(),
            recording: browser.recording,
        };
        const evidence = values["record-dir"]
            ? join(values["record-dir"], "evidence.json")
            : new URL(
                  `./${values.live ? "live" : "offline"}-${values.scenario}-evidence.json`,
                  import.meta.url,
              );
        await writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify(report)}\n`);
        return report;
    } finally {
        try {
            await decisions?.close();
        } finally {
            try {
                await browser?.close();
            } finally {
                await fixture.close();
            }
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCrossword()
        .then((report) => {
            if (report.status === "failed_closed") process.exitCode = 1;
        })
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
