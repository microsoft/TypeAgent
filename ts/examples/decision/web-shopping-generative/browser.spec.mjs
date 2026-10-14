import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { createGenerativeClient } from "../generative/client.mjs";
import { openBrowser, startFixture } from "../web-shopping/browser.mjs";
import {
    assertFresh,
    explicitAct,
    observeHost,
} from "../web-shopping/observer.mjs";
import { fixtureGenerativeClient, generateTarget } from "./selection.mjs";
import { options, runDemo, tasks, verifyShopping } from "./run.mjs";

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

test("structured JSON baseline selects issued refs and verifies both shopping states", async () => {
    let calls = 0;
    const client = createGenerativeClient(
        {},
        { model: "injected-chat-mock" },
        {
            async complete(prompt, callback, structured) {
                calls++;
                assert.ok(
                    prompt[0].content.includes(
                        JSON.stringify(structured.schema),
                    ),
                );
                const { task, evidence } = JSON.parse(prompt[1].content);
                const result = await fixtureGenerativeClient().generate(
                    task,
                    evidence,
                );
                return { success: true, data: JSON.stringify(result.value) };
            },
        },
    );
    for (const request of tasks) {
        const snapshot = await observeHost(browser.page);
        const selected = await generateTarget(snapshot, client, request);
        await explicitAct(
            browser.executor,
            browser.page,
            snapshot,
            selected.candidate,
        );
        assert.equal(await verifyShopping(browser.page, request), true);
    }
    assert.equal(calls, 2);
});

test("generative selected refs fail closed after DOM changes or navigation", async () => {
    for (const mutation of [
        "text",
        "replace",
        "hidden",
        "disabled",
        "inert",
        "duplicate",
        "reload",
    ]) {
        await browser.page.goto(`${fixture.url}/shopping`);
        const snapshot = await observeHost(browser.page);
        const selected = await generateTarget(
            snapshot,
            fixtureGenerativeClient(),
            tasks[0],
        );
        if (mutation === "reload") {
            await browser.page.reload();
            await observeHost(browser.page);
        } else
            await browser.page.evaluate((mutation) => {
                const target = document.querySelector(
                    '[data-fixture-id="cordless-filter"]',
                );
                if (mutation === "text")
                    target.setAttribute("aria-label", "Changed");
                if (mutation === "replace")
                    target.replaceWith(target.cloneNode(true));
                if (mutation === "hidden") target.hidden = true;
                if (mutation === "disabled") target.disabled = true;
                if (mutation === "inert") target.parentElement.inert = true;
                if (mutation === "duplicate")
                    target.parentElement.append(target.cloneNode(true));
            }, mutation);
        let dispatches = 0;
        await assert.rejects(
            explicitAct(
                {
                    act: async () => {
                        dispatches++;
                    },
                },
                browser.page,
                snapshot,
                selected.candidate,
            ),
            /stale_target/,
        );
        assert.equal(dispatches, 0);
    }
});

test("unissued, non-local and malformed host actions cannot dispatch", async () => {
    const snapshot = await observeHost(browser.page);
    const { candidate } = await generateTarget(
        snapshot,
        fixtureGenerativeClient(),
        tasks[0],
    );
    await assert.rejects(
        assertFresh(browser.page, snapshot, { ...candidate }),
        /unissued_candidate/,
    );
    await assert.rejects(
        assertFresh({ url: () => "https://example.com" }, snapshot, candidate),
        /local_fixture_only/,
    );
    for (const action of [
        { ...candidate.action, method: "purchase" },
        { ...candidate.action, arguments: ["extra"] },
        { ...candidate.action, method: "fill", arguments: [] },
        { ...candidate.action, method: "press", arguments: ["Control+L"] },
    ]) {
        const forged = { ...candidate, action };
        const malformed = { ...snapshot, candidates: [forged] };
        await assert.rejects(
            explicitAct(
                { act: () => assert.fail("must not dispatch") },
                browser.page,
                malformed,
                forged,
            ),
            /invalid_host_action|invalid_click_arguments|invalid_action_arguments|disallowed_key/,
        );
    }
});

test("offline baseline runner reports two verified mocks and no live model calls", async () => {
    const report = await runDemo(options([]));
    assert.equal(report.status, "passed");
    assert.equal(report.mode, "offline-fixture-mock");
    assert.equal(report.selectorCalls, 2);
    assert.equal(report.generativeModelCalls, 0);
    assert.equal(report.decisionModelCalls, 0);
    assert.ok(
        report.cases.every(
            (item) => item.verified && item.path === "generative-only",
        ),
    );
});
