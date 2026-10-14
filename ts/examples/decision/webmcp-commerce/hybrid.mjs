// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { stopCopilotClient } from "@typeagent/aiclient";
import { loadRuntimeConfigSync } from "@typeagent/config";
import { createCopilotDecisionClient } from "../decision.mjs";
import { cases } from "./fixtures.mjs";
import { DECISION_MODEL } from "./main.mjs";
import { runGenOnly, runHybridCase } from "./runner.mjs";

export async function run(argv = process.argv.slice(2), options = {}) {
    const { values } = parseArgs({
        args: argv,
        options: {
            live: { type: "boolean", default: false },
            limit: { type: "string" },
            "cli-path": { type: "string" },
            "chat-model": { type: "string" },
            "gen-only": { type: "boolean", default: false },
            help: { type: "boolean", default: false },
        },
        strict: true,
    });
    const write = options.write ?? ((line) => process.stdout.write(line));
    if (values.help) {
        write(
            "Usage: node ts/examples/decision/webmcp-commerce/hybrid.mjs [--live] [--limit 1] [--cli-path <path>] [--chat-model <model>]\n",
        );
        return finish({ modelCalls: 0, exitCode: 0, results: [] });
    }
    if ((values["cli-path"] || values["chat-model"]) && !values.live) {
        throw new Error("--cli-path and --chat-model require --live.");
    }
    if (values["gen-only"] && values.live) {
        throw new Error(
            "--gen-only is an offline comparison contract, not a second live call.",
        );
    }
    if (values["gen-only"]) {
        const result = await runGenOnly(
            cases.find((item) => item.kind === "in-scope"),
            options.generativeClient,
        );
        write(`${JSON.stringify(result)}\n`);
        return finish({
            modelCalls: result.plannerCalls ?? 0,
            exitCode: 0,
            results: [result],
            mode: "gen-only",
        });
    }
    const selected = selectCases(values, cases);
    let started = false;
    let clients;
    if (values.live) {
        const loadedGenerative =
            options.generativeClient ?? (await loadGenerative(values, options));
        if (!loadedGenerative) {
            const blocked = {
                status: "blocked",
                reason: "generative-client-unavailable",
                plannerCalls: 0,
                decisionCalls: 0,
                executed: false,
                mutated: false,
            };
            write(`${JSON.stringify(blocked)}\n`);
            return finish({
                modelCalls: 0,
                exitCode: 2,
                results: [blocked],
                mode: "blocked",
            });
        }
        let decisionClient = options.decisionClient;
        if (!decisionClient) {
            started = true;
            decisionClient = createCopilotDecisionClient(
                loadConfig(options),
                {
                    model: DECISION_MODEL,
                    cliPath: values["cli-path"],
                },
                options.endpointProvider,
            );
        }
        const observed = [];
        const planner = [];
        const generativeClient = recordPlanner(loadedGenerative, planner);
        clients = {
            generativeClient,
            planner,
            decisionClient: {
                async decide(state, questions) {
                    const response = await decisionClient.decide(
                        state,
                        questions,
                    );
                    observed.push(compact(response));
                    return response;
                },
            },
            observed,
        };
    }
    const results = [];
    for (const item of selected) {
        const observedFrom = clients?.observed.length ?? 0;
        const result = clients
            ? await runHybridCase(item, clients)
            : await runHybridCase(item, {});
        results.push({
            id: item.id,
            kind: item.kind,
            request: item.request,
            ...result,
            observed: clients ? clients.observed.slice(observedFrom) : null,
            planner: clients?.planner?.at(-1) ?? null,
        });
        write(`${JSON.stringify(results.at(-1))}\n`);
    }
    if (started) stopCopilotClient();
    return summarizeResults(results, values.live);
}

function summarizeResults(results, live) {
    const modelCalls = results.reduce(
        (total, result) =>
            total + (result.plannerCalls ?? 0) + (result.decisionCalls ?? 0),
        0,
    );
    return finish({
        modelCalls,
        exitCode: results.some((result) => result.status === "failed_closed")
            ? 1
            : results.some((result) => result.status === "blocked")
              ? 2
              : 0,
        results,
        mode: live ? "live" : "offline",
    });
}

function recordPlanner(client, planner) {
    return {
        async generate(...args) {
            try {
                const generated = await client.generate(...args);
                planner.push({
                    requestedModel: generated?.requestedModel ?? null,
                    latencyMs: generated?.latencyMs ?? null,
                    value: generated?.value ?? null,
                });
                return generated;
            } catch {
                planner.push({
                    requestedModel: null,
                    error: "generative_provider_failed",
                });
                throw new Error("generative_provider_failed");
            }
        },
    };
}

function selectCases(values, all) {
    if (values.live) {
        if (values.limit !== undefined && values.limit !== "1") {
            throw new Error("--live accepts at most 1 case.");
        }
        return [all.find((item) => item.kind === "hybrid-plan")];
    }
    if (values.limit !== undefined && !/^[1-9]\d*$/.test(values.limit)) {
        throw new Error("--limit must be a positive integer.");
    }
    const limit = values.limit ? Number(values.limit) : all.length;
    if (limit > all.length) {
        throw new Error(`--limit must be an integer from 1 to ${all.length}.`);
    }
    return all.slice(0, limit);
}

async function loadGenerative(values, options) {
    let loaded;
    try {
        loaded = await import("../generative/client.mjs");
    } catch {
        return null;
    }
    if (typeof loaded.createGenerativeClient !== "function") return null;
    try {
        const config = loadConfig(options);
        return loaded.createGenerativeClient(
            config,
            {
                model: values["chat-model"] ?? config.copilot?.defaultModel,
                cliPath: values["cli-path"],
            },
            options.chatModel,
        );
    } catch {
        return null;
    }
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

function finish(report) {
    return {
        experiment: "webmcp-commerce-hybrid",
        confidenceGuarantee: false,
        separateFromDecisionOnly: true,
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
                "Hybrid commerce pilot failed; check arguments, configuration, and Copilot access. Error details suppressed.",
            );
            process.exitCode = 1;
        })
        .finally(() => stopCopilotClient());
}
