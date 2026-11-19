// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createConfiguredViewSynthesisAdapter } from "@typeagent/memory-service";
import {
    initRuntimeConfigFromProcessEnv,
    openai,
    runWithRequestBudget,
} from "@typeagent/aiclient";
import { loadConfigSync } from "@typeagent/config";
import { originalFixtures } from "./fixtures.js";
import { digest, parseConstructionPacket } from "./packets.js";
import { runInformational } from "./runner.js";
import {
    assertCampaignRuntime,
    configuredModelIdentity,
    parseCampaignBudget,
} from "./campaignBudget.js";

export const usage = `wiki-views --mode offline|live --case <id> --root <new-example-local-run> [--input construction.json] [--authorization approval.json] [--capture-requests]
wiki-views --list
wiki-views --runtime-identity
Offline uses deterministic injection, not model-quality evidence.
Live requires a separate approved configuration and never falls back to offline.`;

function configuredRuntime() {
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    if (!openai.hasChatModelEndpoint())
        throw new Error("Live chat model configuration is missing");
    const adapter = createConfiguredViewSynthesisAdapter();
    const members = openai.getChatModelPool().members.map(({ settings }) => ({
        provider: settings.provider,
        modelName: settings.modelName,
        endpoint: settings.endpoint,
        wireApi: settings.wireApi,
        requestConstraints: settings.requestConstraints,
    }));
    return {
        adapter,
        runtime: {
            configurationHash: digest(
                JSON.stringify({
                    synthesisIdentity: adapter.identity,
                    informationalOutputTokens: 4000,
                    maintenanceMode: "manual",
                    discoveryPolicy: "off",
                    publication: false,
                }),
            ),
            providerSettingsHash: digest(JSON.stringify(members)),
            providers: [
                ...new Set(members.map((member) => member.provider ?? null)),
            ],
            models: [...new Set(members.map(configuredModelIdentity))],
        },
    };
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            help: { type: "boolean" },
            list: { type: "boolean" },
            mode: { type: "string" },
            case: { type: "string" },
            root: { type: "string" },
            input: { type: "string" },
            authorization: { type: "string" },
            "capture-requests": { type: "boolean" },
            "request-budget": { type: "string" },
            "runtime-identity": { type: "boolean" },
            "expected-runtime": { type: "string" },
        },
    });
    if (values.help || !args.length) return usage;
    if (values["runtime-identity"]) {
        if (args.length !== 1)
            throw new Error("--runtime-identity must be used alone");
        const { runtime, adapter } = configuredRuntime();
        return {
            ...runtime,
            nodeVersion: process.version,
            configurationIdentity: adapter.identity,
        };
    }
    const packet: unknown = values.input
        ? JSON.parse(await readFile(values.input, "utf8"))
        : originalFixtures();
    if (values.list)
        return parseConstructionPacket(packet).bundles.map((bundle) => ({
            id: bundle.id,
            kind: bundle.kind,
        }));
    if (
        !values.case ||
        !values.root ||
        (values.mode !== "offline" && values.mode !== "live")
    )
        throw new Error("--case, --root and explicit --mode required");
    if (
        values.mode === "offline" &&
        (values["capture-requests"] ||
            values["request-budget"] ||
            values["expected-runtime"])
    )
        throw new Error(
            "Admitted request capture requires authorized live mode",
        );
    if (values.mode === "offline")
        return (
            await runInformational({
                packet,
                caseId: values.case,
                root: values.root,
                mode: "offline",
            })
        ).receipt;
    return runLive({
        packet,
        caseId: values.case,
        root: values.root,
        authorization: values.authorization,
        captureRequests: values["capture-requests"],
        requestBudget: values["request-budget"],
        expectedRuntime: values["expected-runtime"],
    });
}

async function runLive(options: {
    packet: unknown;
    caseId: string;
    root: string;
    authorization: string | undefined;
    captureRequests: boolean | undefined;
    requestBudget: string | undefined;
    expectedRuntime: string | undefined;
}) {
    if (!options.authorization)
        throw new Error("Live mode requires --authorization");
    const approval: unknown = JSON.parse(
        await readFile(options.authorization, "utf8"),
    );
    if (
        !approval ||
        typeof approval !== "object" ||
        !("approved" in approval) ||
        approval.approved !== true ||
        !("identity" in approval) ||
        typeof approval.identity !== "string" ||
        !approval.identity.trim()
    )
        throw new Error(
            "Live approval requires approved: true and a non-secret identity",
        );
    const configured = configuredRuntime();
    if (options.expectedRuntime) {
        if (!options.requestBudget || !options.captureRequests)
            throw new Error(
                "Frozen campaign execution requires request capture and budgets",
            );
        assertCampaignRuntime(
            {
                ...configured.runtime,
                nodeVersion: process.version,
                configurationIdentity: configured.adapter.identity,
            },
            JSON.parse(await readFile(options.expectedRuntime, "utf8")),
        );
    }
    const budget = options.requestBudget
        ? parseCampaignBudget(
              JSON.parse(await readFile(options.requestBudget, "utf8")),
          )
        : undefined;
    if (budget && !options.captureRequests)
        throw new Error("Campaign budgets require --capture-requests");
    const authorizationIdentity = approval.identity;
    const execute = () =>
        runInformational({
            packet: options.packet,
            caseId: options.caseId,
            root: options.root,
            mode: "live",
            captureRequests: options.captureRequests ?? false,
            ...(budget ? { captureLimits: budget.captureLimits } : {}),
            runtimeIdentity: configured.runtime,
            liveAuthorization: {
                approved: true,
                identity: authorizationIdentity,
            },
            serviceOptions: {
                viewSynthesisAdapter: configured.adapter,
            },
        });
    return (
        await (budget
            ? runWithRequestBudget(budget.budget, execute)
            : execute())
    ).receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main().then(
        (result) =>
            process.stdout.write(
                (typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2)) + "\n",
            ),
        (error: unknown) => {
            console.error(
                error instanceof Error ? error.message : String(error),
            );
            process.exitCode = 1;
        },
    );
