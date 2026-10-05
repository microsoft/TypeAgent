#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI entry point. On PATH as `git-story`, so git also runs it as
// `git story <command>`.
import { Command } from "commander";
import { daemonCommand } from "./commands/daemon.js";
import { hooksCommand } from "./commands/hooks.js";
import { initCommand } from "./commands/init.js";
import { showCommand } from "./commands/show.js";

const program = new Command("git-story")
    .description("Attach agent session stories to git commits")
    .version("0.0.1")
    .addCommand(initCommand)
    .addCommand(showCommand)
    .addCommand(hooksCommand)
    .addCommand(daemonCommand);

program.parse();
