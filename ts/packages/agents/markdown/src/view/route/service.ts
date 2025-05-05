// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import MarkdownIt from "markdown-it";
import { GeoJSONPlugin } from "./plugins/geoJson.js";
import { MermaidPlugin } from "./plugins/mermaid.js";
import { LatexPlugin } from "./plugins/latex.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const app: Express = express();
const portBase = process.env.PORT ? parseInt(process.env.PORT) : 9001;
const markDownPortIndex = 0;
const port = portBase + markDownPortIndex;
const limiter = rateLimit({
    windowMs: 60000,
    max: 100, // limit each IP to 100 requests per windowMs
});

// Serve static content
const staticPath = fileURLToPath(new URL("../site", import.meta.url));

app.use(limiter);
app.use(express.static(staticPath));

app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

// Markdown rendering code
const md = new MarkdownIt();
md.use(GeoJSONPlugin);
md.use(MermaidPlugin);
md.use(LatexPlugin);

let clients: any[] = [];
let filePath: string;

app.get("/preview", (req: Request, res: Response) => {
    if (!filePath) {
        res.send("");
    } else {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const htmlContent = md.render(fileContent);
        res.send(htmlContent);
    }
});

app.get("/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.push(res);

    req.on("close", () => {
        clients = clients.filter((client) => client !== res);
    });
});

function renderFileToClients(filePath: string) {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const htmlContent = md.render(fileContent);

    clients.forEach((client) => {
        client.write(`data: ${encodeURIComponent(htmlContent)}\n\n`);
    });
}

process.send?.("Success");

process.on("message", (message: any) => {
    if (message.type == "setFile") {
        if (filePath) {
            fs.unwatchFile(filePath);
        }
        if (message.filePath) {
            filePath = message.filePath;

            // initial render/reset for clients
            renderFileToClients(filePath!);

            // watch file changes and render as needed
            fs.watchFile(filePath!, () => {
                renderFileToClients(filePath!);
            });
        }
    }
});

process.on("disconnect", () => {
    process.exit(1);
});

// Start the server
app.listen(port);
