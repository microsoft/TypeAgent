// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Context } from "hono";
import type { DaemonSessions } from "../../daemonSessions.js";

// GET /api/daemon: the serving process's pid, e.g. {"pid":4242}.
export const daemonApiHandler = (sessions: DaemonSessions) => (c: Context) =>
    c.json({
        pid: process.pid,
        configured: sessions.configured,
        stopping: sessions.stopping,
    });
