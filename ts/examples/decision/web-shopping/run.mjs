import { parseArgs } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openBrowser, startFixture, verifyShopping } from "./browser.mjs";
import { decisionObserve, explicitAct, observeHost } from "./observer.mjs";
import { decisionProviderOptions } from "../decision.mjs";

export function offlineClient(match) {
    return {
        async decide(state) {
            const candidates = state.candidates.filter((candidate) =>
                match(candidate.evidence, state.request),
            );
            return {
                answers: {
                    target: {
                        choice:
                            candidates.length === 1
                                ? candidates[0].id
                                : "no_fit",
                    },
                    fit: { noul: candidates.length === 1 ? 1 : 0 },
                },
            };
        },
    };
}

export async function decisionClient(values) {
    if (!values.live)
        return {
            client: offlineClient((evidence, request) =>
                request.includes("Which element contains clue")
                    ? evidence.number === request.match(/clue (\d+)/)?.[1] &&
                      evidence.direction ===
                          request.match(/\b(across|down)\b/)?.[1]
                    : request.includes("cordless tools")
                      ? evidence.text.trim() === "Cordless only"
                      : evidence.text === "View Cordless Drill details",
            ),
            close: async () => {},
        };
    const { loadRuntimeConfigSync } = await import("@typeagent/config");
    const { createVariantDecisionClient } = await import("../decision.mjs");
    const { stopCopilotClient } = await import("@typeagent/aiclient");
    const { config } = loadRuntimeConfigSync({
        workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
        populateProcessEnv: false,
    });
    return {
        client: createVariantDecisionClient(config, values),
        close: stopCopilotClient,
    };
}

export function options(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            ...decisionProviderOptions,
            live: { type: "boolean", default: false },
            "dry-run": { type: "boolean", default: false },
            limit: { type: "string", default: "2" },
            "cli-path": { type: "string" },
            variant: { type: "string", default: "host" },
            "native-model": { type: "string" },
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
        throw new Error("--limit must be 1 or 2");
    if (!["host", "native", "rerank"].includes(values.variant))
        throw new Error("--variant must be host, native, or rerank");
    if (values["dry-run"] && values.live)
        throw new Error("--dry-run and --live are mutually exclusive");
    if (values.demo && !values["record-dir"])
        throw new Error("--demo requires --record-dir");
    return values;
}

function recordingSettings(values) {
    return {
        evidenceFile: values["record-dir"]
            ? join(values["record-dir"], "evidence.json")
            : new URL(
                  `./${values.live ? "live" : "offline"}-${values.variant}-evidence.json`,
                  import.meta.url,
              ),
        label: `Decision shopping | ${values.live ? "Live decision model" : "Offline fixture selector"} | Local fixture${values.demo ? " | Demo paced, not benchmark" : ""}`,
    };
}

export async function runShopping(values = options()) {
    const tasks = [
        "Show only cordless tools",
        "Open Cordless Drill details",
    ].slice(0, values.limit);
    if (values.variant !== "host") {
        const report = {
            lane: "shopping",
            variant: values.variant,
            mode: values["dry-run"] ? "dry-run" : "unavailable",
            status: "unavailable",
            reason: "Stagehand was removed with its multi-provider dependency fanout. Native observation and reranking are not implemented in this host-only Playwright runner. Copilot/TypeAgent chat and responses are available, but a native baseline would require a custom client implementation, not new provider secrets.",
            modelInvocations: 0,
        };
        process.stdout.write(JSON.stringify(report) + "\n");
        return report;
    }
    if (values["dry-run"]) {
        process.stdout.write(
            JSON.stringify({
                lane: "shopping",
                mode: "dry-run",
                variant: values.variant,
                tasks,
                modelInvocations: 0,
            }) + "\n",
        );
        return;
    }
    const fixture = await startFixture();
    let browser;
    let decisions;
    const cases = [];
    let decisionCalls = 0;
    const { evidenceFile, label } = recordingSettings(values);
    try {
        browser = await openBrowser({
            recordDirectory: values["record-dir"],
            demo: values.demo,
        });
        decisions = await decisionClient(values);
        const countedClient = {
            async decide(...args) {
                decisionCalls++;
                return decisions.client.decide(...args);
            },
        };
        await browser.page.goto(`${fixture.url}/shopping`);
        for (const request of tasks) {
            await browser.caption(`${label}\nRequest: ${request}`);
            const start = performance.now();
            const snapshot = await observeHost(browser.page);
            const selection = await decisionObserve(
                snapshot,
                countedClient,
                request,
            );
            const chosen = selection?.candidate;
            if (!chosen) {
                cases.push({
                    request,
                    verified: false,
                    status: "abstained",
                    reason: "no_fit_or_ambiguous: reobserve",
                    latencyMs: performance.now() - start,
                    explicitActModelCalls: 0,
                    decision: selection?.response,
                });
                break;
            }
            const action = await explicitAct(
                browser.executor,
                browser.page,
                snapshot,
                chosen,
            );
            if (!action.success) throw new Error("explicit_act_failed");
            const verified = await verifyShopping(browser.page, request);
            if (!verified) throw new Error("shopping_readback_failed");
            cases.push({
                request,
                verified,
                latencyMs: performance.now() - start,
                explicitActModelCalls: 0,
                decision: selection?.response,
            });
            await browser.caption(`${label}\nVerified: ${request}`);
            if (browser.videoPath)
                await browser.page.screenshot({
                    path: join(
                        values["record-dir"],
                        `case-${cases.length}.png`,
                    ),
                });
        }
        const report = {
            lane: "shopping",
            status: cases.every((item) => item.verified)
                ? "passed"
                : "abstained",
            mode: values.live
                ? "live-models-local-fixture"
                : "offline-fixture-selector",
            variant: values.variant,
            automation: "playwright",
            decisionProvider: values.live
                ? (values.provider ?? "copilot")
                : undefined,
            requestedDecisionModel: values.model,
            explicitActModelCalls: 0,
            cases,
            selectorCalls: decisionCalls,
            decisionModelCalls: values.live ? decisionCalls : 0,
            benchmark: false,
            recording: browser.recording,
        };
        await writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify(report)}\n`);
        return report;
    } catch (error) {
        const report = {
            lane: "shopping",
            status: "blocked",
            automation: "playwright",
            explicitActModelCalls: 0,
            reason: error.message,
            cases,
            selectorCalls: decisionCalls,
            decisionModelCalls: values.live ? decisionCalls : 0,
            benchmark: false,
            recording: browser?.recording,
        };
        if (!values["record-dir"] || browser)
            await writeFile(
                evidenceFile,
                `${JSON.stringify(report, null, 2)}\n`,
            );
        throw error;
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
    runShopping()
        .then((report) => {
            if (report && report.status !== "passed") process.exitCode = 1;
        })
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
