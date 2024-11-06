// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Server from "webpack-dev-server";
import fs from "fs";
import { getSessionsDirPath } from "agent-dispatcher/explorer";
import path from "node:path";

import MarkdownIt from "markdown-it";
import { GeoJSONPlugin } from "./plugins/geoJson.js";
import { MermaidPlugin } from "./plugins/mermaid.js";
import { LatexPlugin } from "./plugins/latex.js";

export function getMarkdownFilePath() {
    const sessionsDir = getSessionsDirPath();
    const dirent = fs.readdirSync(sessionsDir, { withFileTypes: true });
    const sessions = dirent.filter((d) => d.isDirectory()).map((d) => d.name);

    // Sort the array in descending order
    sessions.sort((a, b) => {
        if (a < b) {
            return 1;
        } else if (a > b) {
            return -1;
        } else {
            return 0;
        }
    });

    return path.join(getSessionsDirPath(), sessions[0], "markdown", "live.md");
}

export function setupMiddlewares(
    middlewares: Server.Middleware[],
    devServer: Server,
) {
    const app = devServer.app!;
    const md = new MarkdownIt();
    md.use(GeoJSONPlugin);
    md.use(MermaidPlugin);
    md.use(LatexPlugin);

    let clients: any[] = [];

    const filePath = process.env.MARKDOWN_FILE || getMarkdownFilePath();

    app.get("/preview", (req, res) => {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const htmlContent = md.render(fileContent);
        res.send(htmlContent);
    });

    app.get("/events", (req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        clients.push(res);

        req.on("close", () => {
            clients = clients.filter((client) => client !== res);
        });
    });

    fs.watchFile(filePath, () => {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const htmlContent = md.render(fileContent);

        clients.forEach((client) => {
            client.write(`data: ${htmlContent}\n\n`);
        });
    });

    return middlewares;
}
