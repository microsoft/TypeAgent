#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { runCli } from "../dist/cli.js";

const code = await runCli(process.argv.slice(2));
process.exit(code);
