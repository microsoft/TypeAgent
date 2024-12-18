// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Server from "webpack-dev-server";
import {
    getInstanceSessionNames,
    getSessionConstructionDirPaths,
    getSessionConstructionDirPath,
    getInstanceSessionDirPath,
} from "agent-dispatcher/explorer";
import path from "node:path";
import fs from "node:fs";

export function setupMiddlewares(
    middlewares: Server.Middleware[],
    devServer: Server,
) {
    const app = devServer.app!;
    app.get("/sessions", async (req, res) => {
        const sessions = await getInstanceSessionNames();
        res.json(sessions);
    });

    app.get("/session/:session/caches", async (req, res) => {
        try {
            const sessionName = req.params.session;
            const sessionDir = getInstanceSessionDirPath(sessionName);
            const caches = await getSessionConstructionDirPaths(sessionDir);
            res.json(caches);
        } catch (e: any) {
            res.json([]);
        }
    });

    app.get("/session/:session/cache/:cache", async (req, res) => {
        const sessionDir = getInstanceSessionDirPath(req.params.session);
        const cacheDir = getSessionConstructionDirPath(sessionDir);
        res.json(
            JSON.parse(
                await fs.promises.readFile(
                    path.join(cacheDir, req.params.cache),
                    "utf-8",
                ),
            ),
        );
    });

    return middlewares;
}
