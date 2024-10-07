// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import registerDebug from "debug";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { displaySuccess } from "@typeagent/agent-sdk/helpers/display";

function toNamespace(regexp: RegExp) {
    return regexp
        .toString()
        .substring(2, regexp.toString().length - 2)
        .replace(/\.\*\?/g, "*");
}

function getCurrentTraceSettings() {
    return [
        ...registerDebug.names.map(toNamespace),
        ...registerDebug.skips
            .map(toNamespace)
            .map((namespace) => "-" + namespace),
    ];
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
        if (params.flags.clear) {
            registerDebug.disable();
            displaySuccess("All trace namespaces cleared", context);
        }
        if (params.args.namespaces !== undefined) {
            registerDebug.enable(
                getCurrentTraceSettings()
                    .concat(params.args.namespaces)
                    .join(","),
            );
        }

        displaySuccess(
            `Current trace settings: ${getCurrentTraceSettings().join(",")}`,
            context,
        );
    }
}
