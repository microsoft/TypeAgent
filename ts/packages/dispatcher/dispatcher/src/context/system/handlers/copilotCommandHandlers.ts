// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import {
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";

class CopilotImportCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Import GitHub Copilot Chat sessions as conversation mirrors";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const importCopilot = context.sessionContext.agentContext.copilotImport;
        if (importCopilot === undefined) {
            // No ConversationManager behind this host (e.g. standalone local
            // mode) — importing isn't possible here.
            displayWarn(
                "Importing GitHub Copilot sessions is not supported in this session.",
                context,
            );
            return;
        }

        // Progress and result stream to the user through clientIO, so this
        // renders in the chat for every client (Electron shell, VS Code, CLI).
        displayStatus("Reading GitHub Copilot session store…", context);
        try {
            const summary = await importCopilot((progress) => {
                displayStatus(
                    `Importing GitHub Copilot sessions ${progress.current}/${progress.total}: ${progress.name}`,
                    context,
                );
            });

            if (summary.total === 0) {
                displayWarn(
                    "No GitHub Copilot sessions found to import.",
                    context,
                );
                return;
            }

            const parts = [`${summary.imported} imported`];
            if (summary.skipped > 0) {
                parts.push(`${summary.skipped} already imported`);
            }
            if (summary.failed > 0) {
                parts.push(`${summary.failed} failed`);
            }
            displaySuccess(
                `GitHub Copilot import complete: ${parts.join(", ")}.`,
                context,
            );
        } catch (e) {
            throw new Error(
                `Failed to import GitHub Copilot sessions: ${
                    e instanceof Error ? e.message : String(e)
                }`,
            );
        }
    }
}

export function getCopilotCommandHandlers(): CommandHandlerTable {
    return {
        description: "GitHub Copilot session commands",
        defaultSubCommand: "import",
        commands: {
            import: new CopilotImportCommandHandler(),
        },
    };
}
