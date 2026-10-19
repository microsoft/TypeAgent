#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { main } from "../dist/cli.js";

process.exitCode = await main(process.argv.slice(2));
