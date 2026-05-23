#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow LSP server entry point. Starts the language server on stdio.
 *
 * This bin script is what `workflow-lsp` resolves to and what the VS
 * Code extension launches as a child process. Other LSP-capable editors
 * can also spawn it directly.
 */

import { createServer } from "./server.js";

createServer().listen();
