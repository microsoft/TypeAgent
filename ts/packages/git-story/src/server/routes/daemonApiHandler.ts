// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RouteHandler } from "../router.js";

// GET /api/daemon: the serving process's pid, e.g. {"pid":4242}.
export const daemonApiHandler: RouteHandler = (_req, res) => {
    res.json(200, { pid: process.pid });
};
