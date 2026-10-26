// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWebFlowAction } from "../dist/agent/webFlows/actionHandler.mjs";
import { WebFlowStore } from "../dist/agent/webFlows/store/webFlowStore.mjs";
import { loadSampleFlows } from "../dist/agent/webFlows/sampleFlowLoader.mjs";
import { WebFlowBrowserAPIImpl } from "../dist/agent/webFlows/webFlowBrowserApi.mjs";
import { UiDecisionService } from "../dist/agent/webFlows/uiDecisionService.mjs";

async function setup(t, shoppingMode) {
    const files = new Map();
    const store = new WebFlowStore({
        read: async (name) => files.get(name),
        write: async (name, data) => files.set(name, data),
    });
    await store.initialize();
    for (const sample of loadSampleFlows()) await store.save(sample);
    const calls = {
        selections: [],
        actions: [],
        conditions: [],
        extractions: [],
        waits: [],
    };
    const browser = {
        getBrowserSettings: t.mock.fn(async () => ({ shoppingMode })),
        getPageUrl: async () => "https://shop.example/products",
        enterTextIn: t.mock.fn(async () => {}),
        clickOn: t.mock.fn(async () => {}),
        awaitPageLoad: async (timeout) => calls.waits.push(timeout),
    };
    t.mock.method(
        WebFlowBrowserAPIImpl.prototype,
        "extractComponent",
        async (definition, request) => {
            calls.extractions.push({ definition, request });
            return {
                cssSelector: "#search",
                submitButtonCssSelector: "#submit",
                name: "Coffee",
                detailsLinkSelector: "#coffee",
            };
        },
    );
    t.mock.method(
        UiDecisionService.prototype,
        "selectElement",
        async (request) => {
            calls.selections.push(request);
            return { targetId: "target", name: "Coffee", role: "link" };
        },
    );
    t.mock.method(
        UiDecisionService.prototype,
        "execute",
        async (target, action) => {
            calls.actions.push({ target, action });
            return { dispatched: true };
        },
    );
    t.mock.method(
        UiDecisionService.prototype,
        "evaluatePageCondition",
        async (condition, scope) => {
            calls.conditions.push({ condition, scope });
            return { status: "matched", explanation: "Observed results" };
        },
    );
    const context = {
        agentContext: {
            webFlowStore: store,
            useExternalBrowserControl: false,
            clientBrowserControl: browser,
        },
    };
    const execute = (actionName, parameters = {}) =>
        handleWebFlowAction(
            {
                actionName,
                parameters: { productName: "Coffee", ...parameters },
            },
            context,
        );
    return { store, browser, calls, execute };
}

for (const actionName of ["searchForProduct", "navigateToProductPage"]) {
    for (const mode of ["generative", "decision"]) {
        test(`${actionName} uses the ${mode} API path selected in extension settings`, async (t) => {
            const { calls, execute, store } = await setup(t, mode);
            const saved = await store.get(actionName);
            const result = await execute(actionName, {
                navigationTimeoutMs: 15000,
            });
            assert.equal(result.data.success, true, result.displayText);
            assert.deepEqual(calls.waits, [15000]);
            assert.deepEqual(await store.get(actionName), saved);
            if (mode === "decision") {
                assert.equal(calls.extractions.length, 0);
                assert.equal(calls.selections.length, 1);
                assert.equal(calls.actions.length, 1);
                assert.equal(calls.conditions.length, 1);
                assert.equal(calls.selections[0].frameScope, "main-document");
                assert.equal(calls.conditions[0].scope, "main-document");
                assert.equal(
                    calls.actions[0].action.type,
                    actionName === "searchForProduct" ? "fill" : "activate",
                );
            } else {
                assert.equal(calls.extractions.length, 1);
                assert.equal(calls.selections.length, 0);
                assert.equal(calls.actions.length, 0);
                assert.equal(calls.conditions.length, 0);
            }
        });
    }
}

test("a mode change takes effect on the next command without rewriting saved scripts", async (t) => {
    const { calls, browser, execute, store } = await setup(t, "generative");
    const saved = await store.get("searchForProduct");
    await execute("searchForProduct");
    browser.getBrowserSettings = async () => ({ shoppingMode: "decision" });
    await execute("searchForProduct");
    browser.getBrowserSettings = async () => ({ shoppingMode: "generative" });
    await execute("searchForProduct");
    assert.equal(calls.extractions.length, 2);
    assert.equal(calls.selections.length, 1);
    assert.deepEqual(await store.get("searchForProduct"), saved);
});

test("an older extension without shoppingMode preserves Generative behavior", async (t) => {
    const { execute, calls } = await setup(t, undefined);
    const result = await execute("searchForProduct");
    assert.equal(result.data.success, true);
    assert.equal(calls.extractions.length, 1);
    assert.equal(calls.selections.length, 0);
});

for (const actionName of [
    "decisionSearchForProduct",
    "decisionNavigateToProductPage",
]) {
    test(`${actionName} remains an explicit Decision override`, async (t) => {
        const { browser, calls, execute } = await setup(t, "generative");
        const result = await execute(actionName);
        assert.equal(result.data.success, true, result.displayText);
        assert.equal(browser.getBrowserSettings.mock.callCount(), 0);
        assert.equal(calls.selections.length, 1);
        assert.equal(calls.extractions.length, 0);
    });
}

test("Decision search preserves optional search context and the exact query", async (t) => {
    const { calls, execute } = await setup(t, "decision");
    const result = await execute("searchForProduct", {
        selectionCriteria: "Brand X",
    });
    assert.equal(result.data.success, true, result.displayText);
    assert.match(calls.selections[0].condition, /Coffee Brand X/);
    assert.deepEqual(calls.actions[0].action, {
        type: "fill",
        text: "Coffee",
        submit: true,
    });
    assert.match(calls.conditions[0].condition, /"Coffee"/);
});

test("Decision selection errors are explicit with no generative or reasoning fallback", async (t) => {
    const { calls, execute } = await setup(t, "decision");
    t.mock.method(UiDecisionService.prototype, "selectElement", async () => {
        throw new Error("Native Decision unavailable");
    });
    const result = await execute("searchForProduct");
    assert.equal(result.data.success, false);
    assert.match(result.error, /Native Decision unavailable/);
    assert.equal(result.fallbackToReasoning, false);
    assert.equal(result.fallbackContext, undefined);
    assert.equal(calls.extractions.length, 0);
    assert.equal(calls.actions.length, 0);
});

test("a failed Decision postcondition does not retry the mutation or fall back", async (t) => {
    const { calls, execute } = await setup(t, "decision");
    t.mock.method(
        UiDecisionService.prototype,
        "evaluatePageCondition",
        async () => ({
            status: "not_matched",
            explanation: "Wrong page",
        }),
    );
    const result = await execute("navigateToProductPage");
    assert.equal(result.data.success, false);
    assert.match(result.error, /not_matched/);
    assert.equal(result.fallbackToReasoning, false);
    assert.equal(calls.actions.length, 1);
    assert.equal(calls.extractions.length, 0);
});

test("other saved flow names remain unchanged and do not read shopping settings", async (t) => {
    const { store, browser, calls, execute } = await setup(t, "decision");
    const flow = await store.get("searchForProduct");
    const custom = {
        ...flow,
        name: "customShoppingFlow",
        script: "async function execute(browser: WebFlowBrowserAPI, params: FlowParams): Promise<WebFlowResult> { return { success: true, message: 'Custom flow' }; }",
    };
    await store.save(custom);
    const result = await execute(custom.name);
    assert.equal(result.data.success, true);
    assert.equal(result.displayText, "Custom flow");
    assert.equal(browser.getBrowserSettings.mock.callCount(), 0);
    assert.equal(calls.selections.length, 0);
    assert.deepEqual(await store.get(custom.name), custom);
});

test("Generative uses the existing saved implementation rather than replacing it", async (t) => {
    const { store, execute } = await setup(t, "generative");
    const flow = await store.get("searchForProduct");
    await store.save({
        ...flow,
        script: "async function execute(browser: WebFlowBrowserAPI, params: FlowParams): Promise<WebFlowResult> { return { success: true, message: 'Saved search' }; }",
    });
    assert.equal(
        (await execute("searchForProduct")).displayText,
        "Saved search",
    );
});

test("Decision routing preserves the original saved site's scope", async (t) => {
    const { store, execute, calls } = await setup(t, "decision");
    const flow = await store.get("searchForProduct");
    await store.save({
        ...flow,
        scope: { type: "site", domains: ["other.example"] },
    });
    const result = await execute("searchForProduct");
    assert.equal(result.data.error, "scope_mismatch");
    assert.equal(calls.selections.length, 0);
    assert.equal(calls.actions.length, 0);
});

test("invalid settings are not interpreted as Generative", async (t) => {
    const { execute, calls } = await setup(t, "invalid");
    await assert.rejects(execute("searchForProduct"), /Invalid Shopping Mode/);
    assert.equal(calls.extractions.length, 0);
    assert.equal(calls.selections.length, 0);
});

test("settings transport failures do not execute a default implementation", async (t) => {
    const { browser, execute, calls } = await setup(t, "decision");
    browser.getBrowserSettings = async () => {
        throw new Error("Extension disconnected");
    };
    await assert.rejects(execute("searchForProduct"), /Extension disconnected/);
    assert.equal(calls.extractions.length, 0);
    assert.equal(calls.selections.length, 0);
});
