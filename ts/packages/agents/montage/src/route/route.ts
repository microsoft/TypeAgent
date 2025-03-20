// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import Server from "webpack-dev-server";
import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";

const app: Express = express();
const port = process.env.PORT || 9012;

const limiter = rateLimit({
    windowMs: 1000,
    max: 1000, // limit each IP to 100 requests per windowMs
});

// Serve static content
const staticPath = fileURLToPath(new URL("../", import.meta.url));

app.use(limiter);
app.use(express.static(staticPath));

app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

app.get("/image", (req: Request, res: Response) => {

    // load the requested file
    // BUGBUG: not secure...need to assert perms, etc. here
    res.sendFile(req.query.path as string);

});

// export function setupMiddlewares(
//     middlewares: Server.Middleware[],
//     devServer: Server,
// ) {
//     const app = devServer.app!;
//     let clients: any[] = [];

//     sendEvent("startup", null);
//     // VisualizationNotifier.getinstance().onListChanged = (
//     //     lists: TypeAgentList,
//     // ) => {
//     //     sendEvent("updateListVisualization", lists);
//     // };

//     // VisualizationNotifier.getinstance().onKnowledgeUpdated = (
//     //     graph: KnowledgeGraph[][],
//     // ) => {
//     //     sendEvent("updateKnowledgeVisualization", graph);
//     // };

//     // VisualizationNotifier.getinstance().onHierarchyUpdated = (
//     //     hierarchy: KnowledgeHierarchy[],
//     // ) => {
//     //     sendEvent("updateKnowledgeHierarchyVisualization", hierarchy);
//     // };

//     // VisualizationNotifier.getinstance().onWordsUpdated = (words: string[]) => {
//     //     sendEvent("updateWordCloud", words);
//     // };

//     // SSE endpoint
//     app.get("/events", (req, res) => {
//         res.setHeader("Content-Type", "text/event-stream");
//         res.setHeader("Cache-Control", "no-cache");
//         res.setHeader("Connection", "keep-alive");
//         res.flushHeaders();

//         clients.push(res);

//         req.on("close", () => {
//             clients = clients.filter((client) => client !== res);
//         });
//     });

//     // Get all data
//     app.get("/initializeData", async (req, res) => {
//         // const visualizer = VisualizationNotifier.getinstance();

//         // const l = await visualizer.enumerateLists();

//         // if (visualizer.onListChanged != null) {
//         //     visualizer.onListChanged!(l);
//         // }

//         // const know = await visualizer.enumerateKnowledge();
//         // if (visualizer.onKnowledgeUpdated != null) {
//         //     visualizer.onKnowledgeUpdated!(know);
//         // }

//         // const h = await visualizer.enumerateKnowledgeForHierarchy();
//         // if (visualizer.onHierarchyUpdated != null) {
//         //     visualizer.onHierarchyUpdated!(h);
//         // }

//         // const w = await visualizer.enumerateKnowledgeForWordCloud();
//         // if (visualizer.onWordsUpdated != null) {
//         //     visualizer.onWordsUpdated!(w);
//         // }
//     });

//     app.get("/cmd", async (req, res) => {
//         console.debug(req);
//     });

//     // Send events to all clients
//     function sendEvent(event: string, data: any) {
//         clients.forEach((client) => {
//             client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
//         });
//     }

//     return middlewares;
// }

let clients: any[] = [];
//let filePath: string;

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

app.get("/cmd", async (req, res) => {
    console.debug(req);
});

/**
 * Sends data to connected clients.
 * @param message The message to forward to the clients
 */
function sendDataToClients(message: any) {
    clients.forEach((client) => {
        client.write(`data: ${JSON.stringify(message)}\n\n`);
    });
}

/**
 * Indicate to the host/parent process that we've started successfully 
 */
process.send?.("Success");

/**
 * Processes messages received from the host/parent process
 */
process.on("message", (message: any) => {
    // forward the message to any clients
    sendDataToClients(message);
});

/**
 * Closes this process at the request of the host/parent process
 */
process.on("disconnect", () => {
    process.exit(1);
});

// Start the server
app.listen(port);