// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import registerDebug from "debug";
import { ActionContext } from "@typeagent/agent-sdk";
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
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        if (input !== "") {
            if (input === "-" || input === "-*") {
                registerDebug.disable();
            } else {
                registerDebug.enable(
                    getCurrentTraceSettings().concat(input).join(","),
                );
            }
        }

        displaySuccess(
            `Current trace settings: ${getCurrentTraceSettings().join(",")}`,
            context,
        );
    }
}
