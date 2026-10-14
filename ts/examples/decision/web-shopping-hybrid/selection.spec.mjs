import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { openBrowser, startFixture } from "../web-shopping/browser.mjs";
import { explicitAct, observeHost } from "../web-shopping/observer.mjs";
import { offlineClient } from "../web-shopping/run.mjs";
import { fixtureGenerativeClient } from "../web-shopping-generative/selection.mjs";
import {
    options,
    tasks,
    verifyShopping,
} from "../web-shopping-generative/run.mjs";
import { selectHybrid } from "./selection.mjs";
import { runHybrid } from "./run.mjs";

let fixture;
let browser;
before(async () => {
    fixture = await startFixture();
    browser = await openBrowser();
});
after(async () => {
    try {
        await browser?.close();
    } finally {
        await fixture?.close();
    }
});
beforeEach(async () => {
    await browser.page.goto(`${fixture.url}/shopping`);
});

test("fit 0.8 fast path never calls generation and dispatches once", async () => {
    const snapshot = await observeHost(browser.page);
    const candidate = snapshot.candidates.find(
        (item) => item.evidence.text.trim() === "Cordless only",
    );
    const metrics = {};
    const selected = await selectHybrid(
        browser.page,
        snapshot,
        {
            decision: {
                decide: async () => ({
                    answers: {
                        target: { choice: candidate.id },
                        fit: { noul: 0.8 },
                    },
                }),
            },
            generative: {
                generate: () => assert.fail("fast path must not generate"),
            },
        },
        tasks[0],
        metrics,
    );
    assert.equal(selected.snapshot, snapshot);
    assert.equal(metrics.path, "decision-fast-path");
    let dispatches = 0;
    await explicitAct(
        {
            async act(...args) {
                dispatches++;
                return browser.executor.act(...args);
            },
        },
        browser.page,
        selected.snapshot,
        selected.candidate,
    );
    assert.equal(dispatches, 1);
    assert.equal(await verifyShopping(browser.page, tasks[0]), true);
});

test("semantic no_fit and low fit reobserve before generation, with no stale ref reuse", async () => {
    for (const fit of [0.79, 1]) {
        const snapshot = await observeHost(browser.page);
        const metrics = {};
        let generativeCalls = 0;
        const selected = await selectHybrid(
            browser.page,
            snapshot,
            {
                decision: {
                    async decide() {
                        await browser.page.evaluate(
                            () =>
                                (document.querySelector("h1").textContent =
                                    "Changed local catalog"),
                        );
                        return {
                            answers: {
                                target: {
                                    choice:
                                        fit === 1
                                            ? "no_fit"
                                            : snapshot.candidates[0].id,
                                },
                                fit: { noul: fit },
                            },
                        };
                    },
                },
                generative: {
                    async generate(task, evidence, schema) {
                        generativeCalls++;
                        assert.ok(
                            evidence.every(
                                ({ id }) =>
                                    !snapshot.candidates.some(
                                        (old) => old.id === id,
                                    ),
                            ),
                        );
                        return fixtureGenerativeClient().generate(
                            task,
                            evidence,
                            schema,
                        );
                    },
                },
            },
            tasks[0],
            metrics,
        );
        assert.notEqual(selected.snapshot.token, snapshot.token);
        assert.equal(metrics.path, "generative-fallback");
        assert.equal(generativeCalls, 1);
        await explicitAct(
            browser.executor,
            browser.page,
            selected.snapshot,
            selected.candidate,
        );
        assert.equal(await verifyShopping(browser.page, tasks[0]), true);
        await browser.page.goto(`${fixture.url}/shopping`);
    }
});

test("decision provider errors and invalid responses do not trigger fallback", async () => {
    const snapshot = await observeHost(browser.page);
    for (const decide of [
        async () => {
            throw new Error("private provider body");
        },
        async () => ({
            answers: { target: { choice: "no_fit" }, fit: { noul: NaN } },
        }),
        async () => ({
            answers: { target: { choice: "unknown" }, fit: { noul: 1 } },
        }),
        async () => ({ refusal: "no" }),
    ])
        await assert.rejects(
            selectHybrid(
                browser.page,
                snapshot,
                {
                    decision: { decide },
                    generative: {
                        generate: () => assert.fail("error must not fallback"),
                    },
                },
                tasks[0],
            ),
            /decision_provider_failed|invalid_fit|unknown_candidate/,
        );
});

test("fallback no_fit abstains; failed generation is not retried", async () => {
    const snapshot = await observeHost(browser.page);
    const decision = offlineClient(() => false);
    const abstained = await selectHybrid(
        browser.page,
        snapshot,
        {
            decision,
            generative: {
                generate: async () => ({ value: { choice: "no_fit" } }),
            },
        },
        tasks[0],
    );
    assert.equal(abstained.candidate, undefined);
    let calls = 0;
    await assert.rejects(
        selectHybrid(
            browser.page,
            snapshot,
            {
                decision,
                generative: {
                    async generate() {
                        calls++;
                        throw new Error("generative_provider_failed");
                    },
                },
            },
            tasks[0],
        ),
        /generative_provider_failed/,
    );
    assert.equal(calls, 1);
});

test("both hybrid paths retain the freshness guard and never retry dispatch", async () => {
    for (const fallback of [false, true]) {
        const snapshot = await observeHost(browser.page);
        const selected = await selectHybrid(
            browser.page,
            snapshot,
            {
                decision: offlineClient(
                    (evidence) =>
                        !fallback && evidence.text.trim() === "Cordless only",
                ),
                generative: fixtureGenerativeClient(),
            },
            tasks[0],
        );
        await browser.page.evaluate(
            () =>
                (document.querySelector("h1").textContent =
                    "Mutation after selection"),
        );
        let dispatches = 0;
        await assert.rejects(
            explicitAct(
                {
                    act: () => {
                        dispatches++;
                    },
                },
                browser.page,
                selected.snapshot,
                selected.candidate,
            ),
            /stale_target/,
        );
        assert.equal(dispatches, 0);
        await browser.page.goto(`${fixture.url}/shopping`);
    }
});

test("separate hybrid runner verifies both tasks and labels mock paths", async () => {
    const report = await runHybrid(options([]));
    assert.equal(report.status, "passed");
    assert.deepEqual(
        report.cases.map(({ path }) => path),
        ["decision-fast-path", "generative-fallback"],
    );
    assert.ok(report.cases.every(({ verified }) => verified));
    assert.equal(report.selectorCalls, 3);
    assert.equal(report.decisionModelCalls, 0);
    assert.equal(report.generativeModelCalls, 0);
    assert.equal(report.benchmark, false);
});
