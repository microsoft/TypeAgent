// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createConfiguredViewSynthesisAdapter } from "@typeagent/memory-service";
import { initRuntimeConfigFromProcessEnv, openai } from "@typeagent/aiclient";
import { loadConfigSync } from "@typeagent/config";
import { originalFixtures } from "./fixtures.js";
import { parseConstructionPacket } from "./packets.js";
import { runInformational } from "./runner.js";

export const usage = `wiki-views --mode offline|live --case <id> --root <new-example-local-run> [--input construction.json] [--authorization approval.json]
wiki-views --list
Offline uses deterministic injection, not model-quality evidence.
Live requires a separate approved configuration and never falls back to offline.`;

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
        },
    });
    if (values.help || !args.length) return usage;
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
    if (values.mode === "offline")
        return (
            await runInformational({
                packet,
                caseId: values.case,
                root: values.root,
                mode: "offline",
            })
        ).receipt;
    if (!values.authorization)
        throw new Error("Live mode requires --authorization");
    const approval: unknown = JSON.parse(
        await readFile(values.authorization, "utf8"),
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
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    if (!openai.hasChatModelEndpoint())
        throw new Error("Live chat model configuration is missing");
    return (
        await runInformational({
            packet,
            caseId: values.case,
            root: values.root,
            mode: "live",
            liveAuthorization: { approved: true, identity: approval.identity },
            serviceOptions: {
                viewSynthesisAdapter: createConfiguredViewSynthesisAdapter(),
            },
        })
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
