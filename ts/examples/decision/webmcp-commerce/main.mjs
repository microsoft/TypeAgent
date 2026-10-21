// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { stopCopilotClient } from "@typeagent/aiclient";
import { loadRuntimeConfigSync } from "@typeagent/config";
import {
    createVariantDecisionClient,
    decisionProviderOptions,
} from "../decision.mjs";
import { cases } from "./fixtures.mjs";
import { runDecisionCase } from "./runner.mjs";
import { deniedTools, eligibleTools } from "./schema.mjs";

export const DECISION_MODEL = "gpt-6-luna-decisions";

export async function run(argv = process.argv.slice(2), options = {}) {
    const { values } = parseArgs({
        args: argv,
        options: {
            ...decisionProviderOptions,
            live: { type: "boolean", default: false },
            limit: { type: "string" },
            "cli-path": { type: "string" },
            help: { type: "boolean", default: false },
        },
        strict: true,
    });
    const write = options.write ?? ((line) => process.stdout.write(line));
    if (values.help) {
        write(
            "Usage: node ts/examples/decision/webmcp-commerce/main.mjs [--live] [--provider copilot|azure] [--model <model/deployment>] [--region <Azure region>] [--limit <n>] [--cli-path <path>]\n",
        );
        return summary({ modelCalls: 0, exitCode: 0, results: [] });
    }
    if (values["cli-path"] && !values.live) {
        throw new Error("--cli-path requires --live.");
    }
    const selected = selectCases(values, cases);
    let client;
    let started = false;
    const observed = [];
    if (values.live) {
        if (options.client) {
            client = options.client;
        } else {
            const config = loadConfig(options);
            started = true;
            client = createVariantDecisionClient(
                config,
                values,
                options.endpointProvider,
            );
        }
        const inner = client;
        client = {
            async decide(state, questions) {
                const response = await inner.decide(state, questions);
                observed.push(compact(response));
                return response;
            },
        };
    }
    const results = [];
    for (const item of selected) {
        const result = await runDecisionCase(item, client);
        results.push({
            id: item.id,
            kind: item.kind,
            request: item.request,
            expectedTool: item.expectedTool ?? null,
            ...result,
            observed: observed.at(-1) ?? null,
        });
        write(`${JSON.stringify(results.at(-1))}\n`);
    }
    const modelCalls = results.reduce(
        (total, result) => total + (result.decisionCalls ?? 0),
        0,
    );
    const report = summary({
        modelCalls,
        exitCode: results.some((result) => result.status === "failed_closed")
            ? 1
            : 0,
        results,
        mode: values.live ? "live" : "offline",
        decisionSource: values.live
            ? `${values.provider}:${values.model ?? (values.provider === "azure" ? process.env.AZURE_DECISION_DEPLOYMENT : DECISION_MODEL)}`
            : "not-run",
        eligible: eligibleTools().map((tool) => tool.name),
        deniedBeforeModel: deniedTools().map((tool) => tool.name),
    });
    if (started) stopCopilotClient();
    return report;
}

function selectCases(values, all) {
    if (values.live) {
        if (values.limit !== undefined && values.limit !== "1") {
            throw new Error("--live accepts at most 1 case.");
        }
        return [all.find((item) => item.kind === "in-scope")];
    }
    return all.slice(0, parseLimit(values.limit, all.length));
}

function parseLimit(value, total) {
    if (value === undefined) return total;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > total) {
        throw new Error(`--limit must be an integer from 1 to ${total}.`);
    }
    return Number(value);
}

function loadConfig(options) {
    if (options.config) return options.config;
    return loadRuntimeConfigSync({
        workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
        populateProcessEnv: false,
    }).config;
}

function compact(response) {
    const answers = response?.answers ?? {};
    return Object.fromEntries(
        Object.entries(answers).map(([name, answer]) => [
            name,
            answer?.type === "choice" ? answer.choice : answer?.noul,
        ]),
    );
}

function summary(report) {
    return {
        experiment: "webmcp-commerce-decision",
        decisionSource:
            report.mode === "live" ? `copilot:${DECISION_MODEL}` : "not-run",
        confidenceGuarantee: false,
        ...report,
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run()
        .then((result) => {
            process.exitCode = result.exitCode;
        })
        .catch(() => {
            console.error(
                "Decision commerce pilot failed; check arguments, configuration, and Copilot access. Error details suppressed.",
            );
            process.exitCode = 1;
        })
        .finally(() => stopCopilotClient());
}
