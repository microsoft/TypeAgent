// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Process entry for the detached daemon that `git story daemon start` spawns.
import { runDaemon } from "./commands/daemon.js";

await runDaemon();
