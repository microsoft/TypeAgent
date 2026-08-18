// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import registerDebug from "debug";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import { otel } from "@typeagent/telemetry";

if (registerDebug.inspectOpts !== undefined) {
    const inspectOpts: any = registerDebug.inspectOpts;
    inspectOpts.maxStringLength = null;
    inspectOpts.maxArrayLength = null;
    inspectOpts.depth = null;
    const formatters = registerDebug.formatters;
    const newFormatters: any = {
        o: function (v: any) {
            const self: any = this;
            self.inspectOpts = { ...registerDebug.inspectOpts };
            return formatters.o.call(this, v);
        },
        O: function (v: any) {
            const self: any = this;
            self.inspectOpts = { ...registerDebug.inspectOpts };
            return formatters.O.call(this, v);
        },
    };
    registerDebug.formatters = newFormatters;
}

export class TraceCommandHandler implements CommandHandler {
    public readonly description = "Enable or disable trace namespaces";
    public readonly action = {
        schema: "system.operations",
        actionName: "configureTrace",
    };
    public readonly parameters = {
        flags: {
            clear: {
                char: "*",
                description: "Clear all trace namespaces",
                type: "boolean",
                default: false,
            },
            preset: {
                description:
                    "Named preset expansion(s) appended alongside positional namespaces. Available: " +
                    Object.keys(otel.TRACE_PRESETS).sort().join(", "),
                type: "string",
                multiple: true,
                optional: true,
            },
        },
        args: {
            namespaces: {
                description: "Namespaces to enable",
                type: "string",
                multiple: true,
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        // Validate presets BEFORE mutating anything so an unknown name leaves
        // trace state untouched.
        const requestedPresets = params.flags.preset ?? [];
        const expansion = otel.expandTracePresets(requestedPresets);
        if (expansion.unknown.length > 0) {
            displayError(
                `Unknown trace preset(s): ${expansion.unknown.join(", ")}. Available: ${Object.keys(otel.TRACE_PRESETS).sort().join(", ")}.`,
                context,
            );
            return;
        }

        // Disable the trace namespaces to get the current settings
        let settings = registerDebug.disable();
        if (params.flags.clear) {
            settings = "";
        }
        const positional = params.args.namespaces ?? [];
        const additions = [...positional, ...expansion.patterns];
        if (additions.length > 0) {
            // Modify the trace namespaces
            settings = (settings ? [settings, ...additions] : additions).join(
                ",",
            );
        }

        // Keep future child processes and active agents aligned for every
        // mutation, including a clear with no additions.
        process.env.DEBUG = settings;
        context.sessionContext.agentContext.agents.setTraceNamespaces(settings);

        // Reenable the trace namespaces
        registerDebug.enable(settings);

        if (params.flags.clear) {
            displaySuccess(
                additions.length === 0
                    ? "All trace namespaces cleared"
                    : "Cleared existing trace namespaces before applying additions",
                context,
            );
        }
        if (expansion.patterns.length > 0) {
            displaySuccess(
                `Applied preset(s) ${requestedPresets.join(", ")} → ${expansion.patterns.join(", ")}`,
                context,
            );
        }
        displaySuccess(`Current trace settings: ${settings}`, context);
    }
}
