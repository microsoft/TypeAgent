// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import registerDebug from "debug";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { displaySuccess } from "@typeagent/agent-sdk/helpers/display";

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
    public readonly parameters = {
        flags: {
            clear: {
                char: "*",
                description: "Clear all trace namespaces",
                type: "boolean",
                default: false,
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
        // Disable the trace namespaces to get the current settings
        let settings = registerDebug.disable();
        if (params.flags.clear) {
            settings = "";
            displaySuccess("All trace namespaces cleared", context);
        }
        if (params.args.namespaces !== undefined) {
            // Modify the trace namespaces
            settings = (
                settings
                    ? [settings, ...params.args.namespaces]
                    : params.args.namespaces
            ).join(",");

            // For new processes, set the DEBUG environment variable
            process.env.DEBUG = settings;

            context.sessionContext.agentContext.agents.setTraceNamespaces(
                settings,
            );
        }

        // Reenable the trace namespaces
        registerDebug.enable(settings);

        displaySuccess(`Current trace settings: ${settings}`, context);
    }
}
