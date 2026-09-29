#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI entry point. On PATH as `git-commit-story`, so git also runs it as
// `git commit-story <command>`.
import { Command } from "commander";
import { hooksCommand } from "./commands/hooks.js";
import { initCommand } from "./commands/init.js";

const program = new Command("git-commit-story")
    .description("Attach agent session stories to git commits")
    .version("0.0.1")
    .addCommand(initCommand)
    .addCommand(hooksCommand);

program.parse();
