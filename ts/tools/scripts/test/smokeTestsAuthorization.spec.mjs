// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import yaml from "js-yaml";

const workflow = yaml.load(
    readFileSync(
        new URL(
            "../../../../.github/workflows/smoke-tests.yml",
            import.meta.url,
        ),
        "utf8",
    ),
);
const steps = workflow.jobs.shell_and_cli.steps;
const permissionStep = steps.find((step) => step.id === "checkAccess");
const rejectionStep = steps.find(
    (step) => step.name === "Check User Permission",
);

function evaluateCondition(
    condition,
    actor,
    permission,
    eventName = "pull_request_target",
) {
    // These conditions use JS-compatible operators with GitHub's contains/fromJSON functions.
    const expression = condition
        .slice("${{".length, -"}}".length)
        .replaceAll(
            "steps.checkAccess.outputs.require-result",
            "steps.checkAccess.outputs['require-result']",
        );
    return runInNewContext(
        expression,
        {
            github: { event_name: eventName, triggering_actor: actor },
            steps: {
                checkAccess: { outputs: { "require-result": permission } },
            },
            fromJSON: JSON.parse,
            contains(search, value) {
                const lowerValue = String(value).toLowerCase();
                return Array.isArray(search)
                    ? search.some(
                          (item) => String(item).toLowerCase() === lowerValue,
                      )
                    : String(search).toLowerCase().includes(lowerValue);
            },
        },
        { timeout: 1000 },
    );
}

test("checks the triggering actor's write permission before checking out PR code", () => {
    assert.equal(permissionStep.with.require, "write");
    assert.equal(
        permissionStep.with.username,
        "${{ github.triggering_actor }}",
    );
    const checkoutIndex = steps.findIndex(
        (step) => step.name === "Checkout code",
    );
    assert.ok(steps.indexOf(permissionStep) < steps.indexOf(rejectionStep));
    assert.ok(steps.indexOf(rejectionStep) < checkoutIndex);
});

for (const actor of [
    "typeagent-bot",
    "agent-bot",
    "queue",
    "merge",
    "github",
    "bot",
    "TYPEAGENT-BOT",
    "outside-contributor",
]) {
    test(`requires write permission for ${actor}`, () => {
        assert.equal(evaluateCondition(permissionStep.if, actor), true);
        assert.equal(evaluateCondition(rejectionStep.if, actor, "false"), true);
    });
}

for (const actor of [
    "github-merge-queue[bot]",
    "typeagent-bot[bot]",
    "GITHUB-MERGE-QUEUE[BOT]",
    "TYPEAGENT-BOT[BOT]",
]) {
    test(`preserves the exact trusted bot exemption for ${actor}`, () => {
        assert.equal(evaluateCondition(permissionStep.if, actor), false);
        assert.equal(evaluateCondition(rejectionStep.if, actor), false);
    });
}

test("allows a contributor only after write permission is confirmed", () => {
    assert.equal(
        evaluateCondition(permissionStep.if, "maintainer", "true"),
        true,
    );
    assert.equal(
        evaluateCondition(rejectionStep.if, "maintainer", "true"),
        false,
    );
});

for (const permission of [undefined, "", "false", "unexpected"]) {
    test(`rejects an unconfirmed permission result: ${permission}`, () => {
        assert.equal(
            evaluateCondition(
                rejectionStep.if,
                "outside-contributor",
                permission,
            ),
            true,
        );
    });
}

test("preserves manual dispatch without enabling automatic PR triggers", () => {
    assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
    for (const step of [permissionStep, rejectionStep]) {
        assert.equal(
            evaluateCondition(
                step.if,
                "maintainer",
                undefined,
                "workflow_dispatch",
            ),
            false,
        );
    }
});
