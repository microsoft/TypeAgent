// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Process entry for the detached daemon that `git story daemon start` spawns.
import { runDaemon } from "./daemonRuntime.js";

await runDaemon();
