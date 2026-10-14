import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stopCopilotClient } from "@typeagent/aiclient";
import { createGenerativeClient, getConfig } from "../generative/client.mjs";
import { createCopilotDecisionClient } from "../decision.mjs";
import {
    openBrowser,
    startFixture,
    verifyShopping,
} from "../web-shopping/browser.mjs";
import { explicitAct, observeHost } from "../web-shopping/observer.mjs";
import { offlineClient } from "../web-shopping/run.mjs";
import { fixtureGenerativeClient, generateTarget } from "./selection.mjs";

export const tasks = [
    "Show only cordless tools",
    "Open Cordless Drill details",
];

export function options(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            live: { type: "boolean", default: false },
            "dry-run": { type: "boolean", default: false },
            limit: { type: "string", default: "2" },
            "cli-path": { type: "string" },
            "chat-model": { type: "string" },
            "decision-model": {
                type: "string",
                default: "gpt-6-luna-decisions",
            },
            "record-dir": { type: "string" },
            demo: { type: "boolean", default: false },
        },
    });
    values.limit = Number(values.limit);
    if (
        !Number.isSafeInteger(values.limit) ||
        values.limit < 1 ||
        values.limit > 2
    )
        throw new Error("invalid_limit");
    if (values.live && values["dry-run"]) throw new Error("conflicting_modes");
    if (values.demo && !values["record-dir"])
        throw new Error("--demo requires --record-dir");
    return values;
}

export async function selectGenerative(
    page,
    snapshot,
    clients,
    request,
    metrics,
) {
    metrics.path = "generative-only";
    const started = performance.now();
    try {
        const generated = await generateTarget(
            snapshot,
            clients.generative,
            request,
        );
        metrics.requestedChatModel = generated.generation?.requestedModel;
        metrics.usage = generated.generation?.usage;
        return { snapshot, candidate: generated.candidate };
    } finally {
        metrics.generativeLatencyMs = performance.now() - started;
    }
}

export { verifyShopping };

const failures = new Set([
    "invalid_generated_choice",
    "unknown_candidate",
    "generative_provider_failed",
    "generative_invalid_json",
    "decision_provider_failed",
    "invalid_fit",
    "invalid_host_action",
    "invalid_click_arguments",
    "invalid_action_arguments",
    "disallowed_key",
    "unissued_candidate",
    "local_fixture_only",
    "explicit_act_failed",
    "shopping_readback_failed",
]);

export function safeFailure(error) {
    if (failures.has(error?.message)) return error.message;
    if (error?.message?.startsWith("stale_target")) return "stale_target";
    return "demo_execution_failed";
}

function createClients(values, hybrid) {
    if (!values.live)
        return {
            generative: fixtureGenerativeClient(),
            decision: offlineClient(
                (evidence, request) =>
                    request === tasks[0] &&
                    evidence.text.trim() === "Cordless only",
            ),
        };
    const config = getConfig();
    return {
        generative: createGenerativeClient(config, {
            model: values["chat-model"],
            cliPath: values["cli-path"],
        }),
        decision: hybrid
            ? createCopilotDecisionClient(config, {
                  model: values["decision-model"],
                  cliPath: values["cli-path"],
              })
            : undefined,
    };
}

export async function runDemo(
    values = options(),
    {
        kind = "generative",
        select = selectGenerative,
        outputDirectory = new URL("./", import.meta.url),
    } = {},
) {
    const report = {
        lane: `shopping-${kind}`,
        ...reportMode(values, kind),
        benchmark: false,
        requestedDecisionModel:
            kind === "hybrid" && values.live
                ? values["decision-model"]
                : undefined,
        status: "passed",
        selectorCalls: 0,
        decisionModelCalls: 0,
        generativeModelCalls: 0,
        explicitActModelCalls: 0,
        cases: [],
    };
    if (values["dry-run"])
        return { ...report, tasks: tasks.slice(0, values.limit) };
    const evidenceUrl = values["record-dir"]
        ? pathToFileURL(resolve(values["record-dir"], "evidence.json"))
        : new URL(
              `${values.live ? "live" : "offline"}-evidence.json`,
              outputDirectory,
          );
    const checkpoint = () =>
        writeFile(
            evidenceUrl,
            `${JSON.stringify({ ...report, status: "running" }, null, 2)}\n`,
        );
    let fixture;
    let browser;
    const label = `${kind === "hybrid" ? "Hybrid" : "Generative"} shopping | ${values.live ? "Live models" : "Offline fixture mocks"} | Local fixture${values.demo ? " | Demo paced, not benchmark" : ""}`;
    try {
        fixture = await startFixture();
        browser = await openBrowser({
            recordDirectory: values["record-dir"],
            demo: values.demo,
        });
        report.recording = browser.recording;
        const clients = createClients(values, kind === "hybrid");
        await browser.page.goto(`${fixture.url}/shopping`);
        for (const request of tasks.slice(0, values.limit)) {
            await browser.caption(`${label}\nRequest: ${request}`);
            const metrics = {
                request,
                verified: false,
                decisionCalls: 0,
                generativeCalls: 0,
                decisionLatencyMs: 0,
                generativeLatencyMs: 0,
                explicitActModelCalls: 0,
            };
            report.cases.push(metrics);
            const counted = {
                decision: {
                    async decide(...args) {
                        metrics.decisionCalls++;
                        report.selectorCalls++;
                        if (values.live) report.decisionModelCalls++;
                        await checkpoint();
                        return clients.decision.decide(...args);
                    },
                },
                generative: {
                    async generate(...args) {
                        metrics.generativeCalls++;
                        report.selectorCalls++;
                        if (values.live) report.generativeModelCalls++;
                        await checkpoint();
                        return clients.generative.generate(...args);
                    },
                },
            };
            const started = performance.now();
            try {
                const snapshot = await observeHost(browser.page);
                const selection = await select(
                    browser.page,
                    snapshot,
                    counted,
                    request,
                    metrics,
                );
                metrics.candidateId = selection.candidate?.id;
                if (!selection.candidate) {
                    metrics.failure = "no_fit";
                    report.status = "abstained";
                    break;
                }
                const action = await explicitAct(
                    browser.executor,
                    browser.page,
                    selection.snapshot,
                    selection.candidate,
                );
                if (!action.success) throw new Error("explicit_act_failed");
                metrics.verified = await verifyShopping(browser.page, request);
                if (!metrics.verified)
                    throw new Error("shopping_readback_failed");
            } catch (error) {
                metrics.failure = safeFailure(error);
                report.status = "blocked";
                report.reason = metrics.failure;
                break;
            } finally {
                metrics.latencyMs = performance.now() - started;
                metrics.decisionModelCalls = values.live
                    ? metrics.decisionCalls
                    : 0;
                metrics.generativeModelCalls = values.live
                    ? metrics.generativeCalls
                    : 0;
            }
            await browser.caption(
                `${label}\nVerified: ${request} | ${metrics.path}`,
            );
            if (browser.videoPath)
                await browser.page.screenshot({
                    path: join(
                        values["record-dir"],
                        `case-${report.cases.length}.png`,
                    ),
                });
        }
    } catch (error) {
        report.status = "blocked";
        report.reason = safeFailure(error);
    } finally {
        try {
            if (values.live) await stopCopilotClient();
        } finally {
            try {
                await browser?.close();
            } finally {
                await fixture?.close();
            }
        }
    }
    if (!values["record-dir"] || browser)
        await writeFile(evidenceUrl, `${JSON.stringify(report, null, 2)}\n`);
    return report;
}

function reportMode(values, kind) {
    return {
        mode: values.live
            ? "live-models-local-fixture"
            : values["dry-run"]
              ? "dry-run"
              : "offline-fixture-mock",
        modelKind: values.live
            ? kind === "hybrid"
                ? "decision-with-generative-fallback"
                : "generative-chat"
            : "fixture-mocks-not-models",
    };
}

export async function main(run = runDemo) {
    try {
        const report = await run();
        process.stdout.write(`${JSON.stringify(report)}\n`);
        if (report.status !== "passed") process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`${safeFailure(error)}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main();
