import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { catalog, cases } from "./fixtures.mjs";
import { lexicalBaseline, route } from "./router.mjs";
import {
    createVariantDecisionClient,
    decisionProviderOptions,
    requestedDecisionModel,
} from "../decision.mjs";

export const variants = ["decisionChoice", "retrievalDecision", "hierarchical"];

export async function run(argv = process.argv.slice(2), options = {}) {
    const { values } = parseArgs({
        args: argv,
        options: {
            ...decisionProviderOptions,
            live: { type: "boolean", default: false },
            "dry-run": { type: "boolean", default: false },
            limit: { type: "string" },
            "cli-path": { type: "string" },
            help: { type: "boolean", default: false },
        },
    });
    const log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
    if (values.help) {
        log(
            "Usage: node ts/examples/decision/dispatcher/main.mjs [--dry-run | --live] [--provider copilot|azure] [--model <model/deployment>] [--region <Azure region>] [--limit 1..26] [--cli-path <executable>]",
        );
        return 0;
    }
    if (values.live && values["dry-run"])
        throw new Error("--live conflicts with --dry-run.");
    if (values["cli-path"] && !values.live)
        throw new Error("--cli-path requires --live.");
    const limit =
        values.limit === undefined ? cases.length : Number(values.limit);
    if (
        (values.limit !== undefined && !/^[1-9]\d*$/.test(values.limit)) ||
        !Number.isSafeInteger(limit) ||
        limit > cases.length
    ) {
        throw new Error("--limit must be an integer from 1 to 26.");
    }
    let client;
    if (values.live) {
        if (options.client) client = options.client;
        else {
            const { loadRuntimeConfigSync } = await import("@typeagent/config");
            const { config } = loadRuntimeConfigSync({
                workspaceRoot: fileURLToPath(
                    new URL("../../../", import.meta.url),
                ),
                populateProcessEnv: false,
            });
            client = createVariantDecisionClient(config, values);
        }
    }
    let failures = 0;
    let mismatches = 0;
    for (const item of cases.slice(0, limit)) {
        const results = {};
        for (const variant of variants) {
            results[variant] = client
                ? await route(item.request, catalog, variant, client)
                : { actual: null, reason: "offline-not-run", calls: 0 };
            if (results[variant].failed) failures++;
            if (client) {
                results[variant].matchesLabel =
                    results[variant].actual === item.expected;
                if (!results[variant].matchesLabel) mismatches++;
            }
        }
        log(
            JSON.stringify({
                experiment: "dispatcher-routing",
                ...item,
                mode: client ? (options.client ? "mock" : "live") : "offline",
                baseline: {
                    ...lexicalBaseline(item.request, catalog),
                    implementation: "lexical-overlap-not-production-embedding",
                },
                variants: results,
            }),
        );
    }
    log(
        JSON.stringify({
            summary: true,
            cases: limit,
            failures,
            mismatches,
            decisionSource: client
                ? options.client
                    ? "mock"
                    : `${values.provider}:${requestedDecisionModel(values)}`
                : "not-run",
        }),
    );
    return failures ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run()
        .then((code) => {
            process.exitCode = code;
        })
        .catch(() => {
            console.error(
                "Dispatcher pilot failed; check arguments, configuration, and Copilot access. Error details suppressed.",
            );
            process.exitCode = 1;
        })
        .finally(async () => {
            if (process.argv.includes("--live")) {
                const { stopCopilotClient } = await import(
                    "@typeagent/aiclient"
                );
                await stopCopilotClient();
            }
        });
}
