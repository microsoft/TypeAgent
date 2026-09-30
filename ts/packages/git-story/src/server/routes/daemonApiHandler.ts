// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Context } from "hono";

// GET /api/daemon: the serving process's pid, e.g. {"pid":4242}.
export const daemonApiHandler = (c: Context) => c.json({ pid: process.pid });
