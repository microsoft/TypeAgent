#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI entry point. On PATH as `git-commit-story`, so git also runs it as
// `git commit-story <command>`.
import { init } from "./init.js";

const [command] = process.argv.slice(2);
switch (command) {
    case "init":
        init(process.cwd());
        break;
    default:
        console.log("Hello from git-commit-story");
}
