// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Auto-generated CLI handler for ipconfig

import { execFile } from "child_process";
import { promisify } from "util";
import { ActionContext, AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
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
                const formatted = formatOutput(output, action.actionName);
                return formatted.startsWith("#") || formatted.includes("**")
                    ? createActionResultFromMarkdownDisplay(formatted)
                    : createActionResultFromTextDisplay(formatted);
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

function formatOutput(raw: string, actionName: string): string {
    if (!STRUCTURED_ACTIONS.has(actionName)) {
        return raw;
    }

    const lines = raw.split(/\r?\n/);
    const out: string[] = [];

    for (const line of lines) {
        if (line.trim() === "") {
            out.push("");
            continue;
        }

        // Section header: no leading whitespace
        if (!/^\s/.test(line)) {
            const header = line.replace(/:$/, "").trim();
            out.push(`\n## ${header}`);
            continue;
        }

        // Key-value pair: "   Key . . . . . : Value"
        const kv = line.match(/^\s+(.*?)\s*\.[\s.]*:\s*(.*)/);
        if (kv) {
            const key = kv[1].trimEnd();
            const value = kv[2].trim();
            out.push(`- **${key}:** ${value || "—"}`);
            continue;
        }

        out.push(line.trim());
    }

    return out.join("\n").trim();
}
