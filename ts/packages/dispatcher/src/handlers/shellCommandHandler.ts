// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatcherCommandHandler,
    DispatcherHandlerTable,
} from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";

export class ShellShowSettingsCommandHandler
    implements DispatcherCommandHandler
{
    public readonly description = "Show shell settings";
    public async run(input: string, context: any) {
        context.requestIO.result((log: (message?: string) => void) => {
            const printConfig = (options: any, prefix: number = 2) => {
                for (const [key, value] of Object.entries(options)) {
                    const name = `${" ".repeat(prefix)}${key.padEnd(
                        20 - prefix,
                    )}:`;
                    if (typeof value === "object") {
                        log(name);
                        printConfig(value, prefix + 2);
                    } else if (typeof value === "function") {
                    } else {
                        log(`${name} ${value}`);
                    }
                }
            };
            printConfig(context.settings);
        });
    }
}

export class ShellSetSettingCommandHandler implements DispatcherCommandHandler {
    public readonly description: string =
        "Sets a specific setting with the supplied value";
    public async run(input: string, context: CommandHandlerContext) {
        const name = input.substring(0, input.indexOf(" "));
        const newValue = input.substring(input.indexOf(" ") + 1);

        let found: boolean = false;
        for (const [key, value] of Object.entries(context.settings)) {
            if (key == name) {
                found = true;
                context.settings.set(name, newValue);

                break;
            }
        }

        if (!found) {
            context.requestIO.result(
                `The supplied shell setting '${name} could not be found.'`,
            );
        } else {
            context.requestIO.result(`${name} was set to ${newValue}`);
        }
    }
}

export function getShellCommandHandlers(): DispatcherHandlerTable {
    return {
        description: "Shell settings command",
        defaultSubCommand: new ShellShowSettingsCommandHandler(),
        commands: {
            show: new ShellShowSettingsCommandHandler(),
            set: new ShellSetSettingCommandHandler(),
        },
    };
}
