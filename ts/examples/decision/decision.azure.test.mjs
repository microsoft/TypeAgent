import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadRuntimeConfigSync } from "@typeagent/config";
import { createDecisionClient } from "./decision.mjs";
import {
    openBrowser,
    startFixture,
    verifyShopping,
} from "./web-shopping/browser.mjs";
import {
    decisionObserve,
    explicitAct,
    observeHost,
} from "./web-shopping/observer.mjs";
import { createCrosswordActions } from "./crossword-2/crossword.mjs";
import { startCrosswordFixture } from "./crossword-2/fixture.mjs";

const { config } = loadRuntimeConfigSync({
    workspaceRoot: fileURLToPath(new URL("../../", import.meta.url)),
    populateProcessEnv: false,
});
const configKey = process.env.AZURE_DECISION_CONFIG_KEY ?? "decision_1";
const deployment = process.env.AZURE_DECISION_DEPLOYMENT;
if (!deployment?.trim())
    throw new Error(
        "Set AZURE_DECISION_DEPLOYMENT to the actual Azure deployment name, not the underlying model ID.",
    );
const pool = createDecisionClient(config, configKey, deployment);
const regions = process.env.AZURE_DECISION_REGION
    ? [process.env.AZURE_DECISION_REGION]
    : [...new Set(pool.endpoints.map(({ region }) => region))];

const questions = {
    team: {
        type: "choice",
        instructions: "Which team should handle this customer support request?",
        criteria: {
            billing: "Charges, invoices, refunds, or subscription payments",
            technical: "Software errors, bugs, or integration failures",
            account: "Sign-in, password, or account-access problems",
        },
    },
    severity: {
        type: "score",
        instructions: "How severe is this issue?",
        criteria: ["Cosmetic", "Minor", "Major", "Critical"],
    },
    repeat_contact: {
        type: "noul",
        instructions: "Has the customer contacted support before?",
        criteria: {
            true: "Customer contact count is greater than one",
            false: "This is the customer's first contact",
        },
    },
};

for (const region of regions) {
    test(`Azure Decision-1 (${region}): native schema and guarded browsers`, async (context) => {
        const nativeClient = createDecisionClient(
            config,
            configKey,
            deployment,
            region,
        );
        let calls = 0;
        const client = {
            async decide(...args) {
                assert.ok(calls < 8, "Azure smoke request budget exceeded");
                calls++;
                return nativeClient.decide(...args);
            },
        };
        const response = await client.decide(
            {
                message: "Checkout is down again. This is my third request.",
                customer_contact_count: 3,
            },
            questions,
        );
        assert.equal(response.model.toLowerCase(), "microsoft-decision-1");
        assert.equal(Array.isArray(response.answers), false);
        assert.equal(response.answers.team.choice, "technical");
        assert.ok(response.answers.repeat_contact.noul >= 0.5);
        assert.equal(response.answers.severity.type, "score");
        const ticket = await client.decide("I was charged twice.", {
            team: questions.team,
        });
        assert.equal(ticket.answers.team.choice, "billing");
        context.diagnostic(
            JSON.stringify({
                region,
                deployment,
                reportedModel: response.model,
            }),
        );
        await context.test(
            "shopping selects host-issued IDs and verifies both actions",
            async () => {
                const fixture = await startFixture();
                let browser;
                try {
                    browser = await openBrowser();
                    await browser.page.goto(`${fixture.url}/shopping`);
                    for (const request of [
                        "Show only cordless tools",
                        "Open Cordless Drill details",
                    ]) {
                        const snapshot = await observeHost(browser.page);
                        const selection = await decisionObserve(
                            snapshot,
                            client,
                            request,
                        );
                        assert.ok(
                            selection?.candidate,
                            "Decision-1 abstained; host did not act",
                        );
                        const action = await explicitAct(
                            browser.executor,
                            browser.page,
                            snapshot,
                            selection.candidate,
                        );
                        assert.equal(action.success, true);
                        assert.equal(
                            await verifyShopping(browser.page, request),
                            true,
                        );
                    }
                } finally {
                    try {
                        await browser?.close();
                    } finally {
                        await fixture.close();
                    }
                }
            },
        );
        await context.test(
            "Crossword 2 reads clues, fills supplied answers, and rejects conflicts",
            async () => {
                const fixture = await startCrosswordFixture();
                let browser;
                try {
                    browser = await openBrowser();
                    await browser.page.goto(fixture.url);
                    const actions = createCrosswordActions({
                        ...browser,
                        client,
                    });
                    assert.equal(
                        await actions.getClueValue(1, "across"),
                        "Device producing a concentrated beam of light (5)",
                    );
                    assert.equal(
                        (await actions.enterText("laser", 1, "across"))
                            .readback,
                        "LASER",
                    );
                    assert.equal(
                        (await actions.enterText("later", 1, "down")).readback,
                        "LATER",
                    );
                    const beforeConflict = calls;
                    await assert.rejects(
                        actions.enterText("water", 1, "down"),
                        /crossing_conflict/,
                    );
                    assert.equal(calls, beforeConflict + 1);
                } finally {
                    try {
                        await browser?.close();
                    } finally {
                        await fixture.close();
                    }
                }
            },
        );
        context.diagnostic(JSON.stringify({ region, decisionCalls: calls }));
    });
}
