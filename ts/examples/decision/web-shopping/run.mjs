import { parseArgs } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { openBrowser, startFixture } from "./browser.mjs";
import { decisionObserve, explicitAct, observeHost } from "./observer.mjs";

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
    const { createCopilotDecisionClient } = await import("../decision.mjs");
    const { stopCopilotClient } = await import("@typeagent/aiclient");
    const { config } = loadRuntimeConfigSync({
        workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
        populateProcessEnv: false,
    });
    return {
        client: createCopilotDecisionClient(config, {
            model: values.model,
            cliPath: values["cli-path"],
        }),
        close: stopCopilotClient,
    };
}

export function options(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            live: { type: "boolean", default: false },
            "dry-run": { type: "boolean", default: false },
            limit: { type: "string", default: "2" },
            "cli-path": { type: "string" },
            model: { type: "string", default: "gpt-6-luna-decisions" },
            variant: { type: "string", default: "host" },
            "native-model": { type: "string" },
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
    return values;
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
    try {
        browser = await openBrowser();
        decisions = await decisionClient(values);
        const countedClient = {
            async decide(...args) {
                decisionCalls++;
                return decisions.client.decide(...args);
            },
        };
        await browser.page.goto(`${fixture.url}/shopping`);
        for (const request of tasks) {
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
            const verified = await browser.page.evaluate(
                (request) =>
                    request.includes("cordless tools")
                        ? document.querySelector(
                              '[data-fixture-id="cordless-filter"]',
                          ).checked &&
                          document.querySelector('[data-name="corded saw"]')
                              .hidden
                        : document.querySelector("dialog").open &&
                          document.querySelector("#detail-title").innerText ===
                              "Cordless Drill",
                request,
            );
            if (!verified) throw new Error("shopping_readback_failed");
            cases.push({
                request,
                verified,
                latencyMs: performance.now() - start,
                explicitActModelCalls: 0,
                decision: selection?.response,
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
            explicitActModelCalls: 0,
            cases,
            selectorCalls: decisionCalls,
            decisionModelCalls: values.live ? decisionCalls : 0,
            benchmark: false,
        };
        await writeFile(
            new URL(
                `./${values.live ? "live" : "offline"}-${values.variant}-evidence.json`,
                import.meta.url,
            ),
            `${JSON.stringify(report, null, 2)}\n`,
        );
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
        };
        await writeFile(
            new URL(
                `./${values.live ? "live" : "offline"}-${values.variant}-evidence.json`,
                import.meta.url,
            ),
            `${JSON.stringify(report, null, 2)}\n`,
        );
        throw error;
    } finally {
        await decisions?.close();
        await browser?.close();
        await fixture.close();
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
