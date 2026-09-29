// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";

// `hooks`: agent hook handlers. Placeholder output until story capture exists.
export const hooksCommand = new Command("hooks").description(
    "Agent hook handlers",
);

hooksCommand
    .command("copilot")
    .description("Copilot CLI hook handlers")
    .command("user-prompt-submitted")
    .description("Handle the Copilot userPromptSubmitted hook")
    .action(() => {
        process.stdout.write("Hello World\n");
    });
