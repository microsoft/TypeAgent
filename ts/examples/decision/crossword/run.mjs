import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openBrowser, startFixture } from "../web-shopping/browser.mjs";
import { decisionClient, options } from "../web-shopping/run.mjs";
import { createCrosswordActions } from "./crossword.mjs";

export async function runCrossword(values = options()) {
    if (values.variant !== "host")
        throw new Error(
            "Stagehand was removed; native/rerank are unavailable. Crossword supports host-only Playwright observation.",
        );
    const requests = [
        "getClueValue(1, across)",
        "enterText(cat, 1, across)",
    ].slice(0, values.limit);
    if (values["dry-run"]) {
        process.stdout.write(
            JSON.stringify({
                lane: "crossword",
                mode: "dry-run",
                requests,
                modelInvocations: 0,
            }) + "\n",
        );
        return;
    }
    const fixture = await startFixture();
    let browser;
    let decisions;
    let decisionCalls = 0;
    const responses = [];
    const cases = [];
    const evidenceFile = values["record-dir"]
        ? join(values["record-dir"], "evidence.json")
        : new URL(
              `./${values.live ? "live" : "offline"}-evidence.json`,
              import.meta.url,
          );
    const label = `Crossword | ${values.live ? "Live decision model" : "Offline fixture selector"} | Supplied answer, not a solver${values.demo ? " | Demo paced" : ""}`;
    try {
        browser = await openBrowser({
            recordDirectory: values["record-dir"],
            demo: values.demo,
        });
        decisions = await decisionClient(values);
        await browser.page.goto(`${fixture.url}/crossword`);
        const actions = createCrosswordActions({
            ...browser,
            client: {
                async decide(...args) {
                    decisionCalls++;
                    const response = await decisions.client.decide(...args);
                    responses.push(response);
                    return response;
                },
            },
        });
        for (const [index, request] of requests.entries()) {
            await browser.caption(`${label}\nRequest: ${request}`);
            const start = performance.now();
            let result;
            try {
                result =
                    index === 0
                        ? await actions.getClueValue(1, "across")
                        : await actions.enterText("cat", 1, "across");
            } catch (error) {
                cases.push({
                    request,
                    status: "failed_closed",
                    reason: error.message,
                    latencyMs: performance.now() - start,
                    explicitActModelCalls: 0,
                    decision: responses.at(-1),
                });
                break;
            }
            cases.push({
                request,
                result,
                latencyMs: performance.now() - start,
                explicitActModelCalls: 0,
                decision: responses.at(-1),
            });
            await browser.caption(
                `${label}\nVerified: ${request} = ${JSON.stringify(result)}`,
            );
            if (browser.videoPath)
                await browser.page.screenshot({
                    path: join(
                        values["record-dir"],
                        `case-${cases.length}.png`,
                    ),
                });
        }
        const report = {
            lane: "crossword",
            status: cases.every((item) => item.result !== undefined)
                ? "passed"
                : "failed_closed",
            mode: values.live
                ? "live-decisions-local-fixture"
                : "offline-fixture-selector",
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
            lane: "crossword",
            status: "blocked",
            automation: "playwright",
            explicitActModelCalls: 0,
            reason: error.message,
            cases,
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
    runCrossword()
        .then((report) => {
            if (report && report.status !== "passed") process.exitCode = 1;
        })
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
