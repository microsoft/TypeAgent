// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Auto-generated CLI handler for ipconfig

import { execFile } from "child_process";
import { promisify } from "util";
import { ActionContext, AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import { StructuredBlock, KeyValuePair } from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createStructuredResult,
} from "@typeagent/agent-sdk/helpers/action";
import { IpconfigActions } from "./ipconfigSchema.js";

const execFileAsync = promisify(execFile);

async function runCli(...cliArgs: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync("ipconfig", cliArgs, {
        timeout: 30_000,
    });
    return (stdout || stderr).trim();
}

function buildArgs(action: TypeAgentAction<IpconfigActions>): string[] {
    const args: string[] = [];
    const params = action.parameters as Record<string, unknown>;
    switch (action.actionName) {
        case "displayHelpMessage":
            args.push("/?");
            break;
        case "displayFullConfigurationInformation":
            args.push("/all");
            break;
        case "releaseIPv4Address":
            args.push("/release");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            break;
        case "releaseIPv6Address":
            args.push("/release6");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            break;
        case "renewIPv4Address":
            args.push("/renew");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            break;
        case "renewIPv6Address":
            args.push("/renew6");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            break;
        case "purgeDNSResolverCache":
            args.push("/flushdns");
            break;
        case "refreshDHCPLeasesAndReRegisterDNSNames":
            args.push("/registerdns");
            break;
        case "displayDNSResolverCacheContents":
            args.push("/displaydns");
            break;
        case "displayDHCPClassIDs":
            args.push("/showclassid");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            break;
        case "modifyDHCPClassID":
            args.push("/setclassid");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            if (params.classID !== undefined && params.classID !== null)
                args.push(String(params.classID));
            break;
        case "displayIPv6DHCPClassIDs":
            args.push("/showclassid6");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            break;
        case "modifyIPv6DHCPClassID":
            args.push("/setclassid6");
            if (params.adapter !== undefined && params.adapter !== null)
                args.push(String(params.adapter));
            if (params.classID !== undefined && params.classID !== null)
                args.push(String(params.classID));
            break;
        default:
            throw new Error(
                `Unknown action: ${(action as { actionName: string }).actionName}`,
            );
    }
    return args;
}

export function instantiate(): AppAgent {
    return {
        executeAction: async (
            action: TypeAgentAction<IpconfigActions>,
            context: ActionContext<IpconfigActions>,
        ) => {
            try {
                const args = buildArgs(action);
                const output = await runCli(...args);
                if (STRUCTURED_ACTIONS.has(action.actionName)) {
                    return buildStructuredOutput(output);
                }
                return createActionResultFromTextDisplay(output);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                return createActionResultFromTextDisplay(`Error: ${msg}`);
            }
        },
    };
}

const STRUCTURED_ACTIONS = new Set([
    "displayHelpMessage",
    "displayFullConfigurationInformation",
    "displayDNSResolverCacheContents",
    "displayDHCPClassIDs",
    "displayIPv6DHCPClassIDs",
]);

// Parse `ipconfig` output into structured section blocks. Each section
// (unindented header line) becomes a heading + keyValue block; the dotted
// "Key . . . : Value" lines become key-value pairs. The SDK derives the
// markdown/text fallback for clients that can't render blocks.
//
// Exported for unit tests.
export function buildStructuredOutput(raw: string) {
    const lines = raw.split(/\r?\n/);

    type Section = { heading?: string; pairs: KeyValuePair[]; loose: string[] };
    const sections: Section[] = [];
    let current: Section = { pairs: [], loose: [] };

    const pushCurrent = () => {
        if (current.heading || current.pairs.length || current.loose.length) {
            sections.push(current);
        }
    };

    for (const line of lines) {
        if (line.trim() === "") {
            continue;
        }

        // Section header: no leading whitespace, ends with ":"
        if (!/^\s/.test(line)) {
            pushCurrent();
            current = {
                heading: line.replace(/:$/, "").trim(),
                pairs: [],
                loose: [],
            };
            continue;
        }

        // Key-value pair: "   Key . . . . . : Value"
        // Match on the leading-whitespace-trimmed line with disjoint
        // sub-expressions (key excludes '.'/':' and the dotted separator
        // starts with a literal '.') to avoid polynomial backtracking.
        const kv = line.trimStart().match(/^([^.:]*)\.[.\s]*:\s*(.*)/);
        if (kv) {
            const key = kv[1].trimEnd();
            const value = kv[2].trim();
            current.pairs.push({ label: key, value: value || "—" });
            continue;
        }

        current.loose.push(line.trim());
    }
    pushCurrent();

    const blocks: StructuredBlock[] = [];
    const rawData: Record<string, Record<string, string>> & {
        _lines?: string[];
    } = {};

    for (const section of sections) {
        if (section.heading) {
            blocks.push({ kind: "heading", level: 2, text: section.heading });
        }
        if (section.pairs.length > 0) {
            blocks.push({ kind: "keyValue", pairs: section.pairs });
            const bucket: Record<string, string> = {};
            for (const p of section.pairs) {
                bucket[p.label] = String(p.value);
            }
            rawData[section.heading ?? "General"] = bucket;
        }
        for (const loose of section.loose) {
            blocks.push({ kind: "text", text: loose, format: "text" });
        }
    }

    if (blocks.length === 0) {
        // Nothing parsed into structure — fall back to the raw text.
        return createActionResultFromTextDisplay(raw);
    }

    return createStructuredResult(blocks, { rawData });
}
