#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import {
    CopilotCreditBudget,
    accountedNanoAiu,
} from "../../dispatcher/dispatcher/dist/reasoning/copilotCreditBudget.js";

const [cliPath, ledgerPath, outputDirectory] = process.argv.slice(2);
if (!cliPath || !ledgerPath || !outputDirectory) {
    throw new Error(
        "Usage: node ghcp-credit-probe.mjs <copilot.exe> <ledger.json> <new-output-directory>",
    );
}
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
accountedNanoAiu(ledger);
fs.mkdirSync(outputDirectory);
const client = new CopilotClient({
    mode: "empty",
    baseDirectory: path.join(outputDirectory, "copilot"),
    workingDirectory: outputDirectory,
    connection: RuntimeConnection.forStdio({ path: cliPath }),
    requestHandler: new CopilotCreditBudget(path.resolve(ledgerPath)),
    useLoggedInUser: true,
    logLevel: "error",
});
const result = {
    kind: "credit_control_calibration_not_eval",
    sessionId: randomUUID(),
    status: "not_started",
    usage: [],
};
let session;
try {
    await client.start();
    session = await client.createSession({
        sessionId: result.sessionId,
        model: ledger.model,
        reasoningEffort: "low",
        contextTier: "default",
        sessionLimits: { maxAiCredits: 30 },
        capi: { enableWebSocketResponses: false },
        availableTools: [],
        skipCustomInstructions: true,
        onPermissionRequest: () => ({
            kind: "denied-no-approval-rule-and-could-not-request-from-user",
        }),
    });
    session.on("assistant.usage", (event) => {
        result.usage.push({
            model: event.data.model,
            copilotUsage: event.data.copilotUsage,
            inputTokens: event.data.inputTokens,
            outputTokens: event.data.outputTokens,
        });
    });
    result.status = "running";
    await session.sendAndWait({ prompt: "Reply with exactly OK." }, 60_000);
    result.status = "completed";
} catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
} finally {
    if (session) await session.abort();
    await client.stop();
    fs.writeFileSync(
        path.join(outputDirectory, "result.json"),
        JSON.stringify(result, null, 2) + "\n",
    );
    process.stdout.write(JSON.stringify(result) + "\n");
}
