// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@browser lookup ...` commands to switch how internet lookups
// (lookupAndAnswerInternet) are answered at runtime, without restarting the
// agent-server. The mode is read per-call in lookup(), so the override on the
// agent context takes effect immediately. It is not persisted - on restart the
// value reverts to azureAISearch.mode / AZURE_AI_SEARCH_LOOKUP_MODE.

import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    ActionContext,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    displayError,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import { BrowserActionContext } from "../browserActions.mjs";
import {
    AiSearchLookupMode,
    getAiSearchConfigFromEnv,
    getConfiguredLookupMode,
} from "./aiSearchLookup.mjs";

const LOOKUP_MODES: AiSearchLookupMode[] = ["off", "api", "mcp"];

export class LookupCommandHandlerTable implements CommandHandlerTable {
    public readonly description =
        "Configure how internet lookups are answered (browser vs Azure AI Search)";
    public readonly defaultSubCommand = "status";
    public readonly commands = {
        status: new LookupStatusCommandHandler(),
        mode: new LookupModeCommandHandler(),
    };
}

class LookupStatusCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show the current internet lookup mode";
    public async run(
        context: ActionContext<BrowserActionContext>,
    ): Promise<void> {
        const override = context.sessionContext.agentContext.lookupMode;
        const configured = getConfiguredLookupMode();
        const effective = override ?? configured;
        const resolved = getAiSearchConfigFromEnv(override);

        const lines = [
            `configured (azureAISearch.mode): ${configured}`,
            `override (@browser lookup): ${override ?? "none"}`,
        ];
        if (resolved) {
            lines.push(
                `effective: ${effective} -> Azure AI Search (endpoint ${resolved.endpoint}, kb ${resolved.knowledgeBase})`,
            );
        } else {
            const reason =
                effective === "off"
                    ? ""
                    : " (endpoint/knowledgeBase not configured)";
            lines.push(`effective: ${effective} -> browser${reason}`);
        }
        displaySuccess(lines.join("\n"), context);
    }
}

class LookupModeCommandHandler implements CommandHandler {
    public readonly description =
        "Set the internet lookup mode: off (browser), api, or mcp";
    public readonly parameters = {
        args: {
            mode: {
                description: "off | api | mcp",
            },
        },
    } as const;

    public async run(
        context: ActionContext<BrowserActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const value = params.args.mode.toLowerCase();
        if (value !== "off" && value !== "api" && value !== "mcp") {
            displayError(
                `Invalid mode '${params.args.mode}'. Use: off, api, or mcp.`,
                context,
            );
            return;
        }
        const mode = value as AiSearchLookupMode;
        context.sessionContext.agentContext.lookupMode = mode;

        let message =
            mode === "off"
                ? "Internet lookups will use the browser."
                : `Internet lookups will use Azure AI Search (${mode}).`;
        if (mode !== "off" && getAiSearchConfigFromEnv(mode) === undefined) {
            message +=
                " Note: azureAISearch.endpoint/knowledgeBase aren't configured, so lookups fall back to the browser.";
        }
        displaySuccess(message, context);
    }

    public async getCompletion(
        _context: SessionContext<BrowserActionContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        return {
            groups: names
                .filter((name) => name === "mode")
                .map((name) => ({
                    name,
                    completions: [...LOOKUP_MODES],
                })),
        };
    }
}
