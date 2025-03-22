// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import Server from "webpack-dev-server";
import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";
import fs from "node:fs";

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

/**
 * Gets the root document
 */
app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

/**
 * Serves up requested images
 * TODO: secure path access to image folder only
 */
app.get("/image", (req: Request, res: Response) => {

    // load the requested file
    // BUGBUG: not secure...need to assert perms, etc. here
    res.sendFile(req.query.path as string);

});

/**
 * Gets the knowledge reponse file for the supplied image (if available)
 * Used for debugging purposes only.
 */
app.get("/knowlegeResponse", (req: Request, res: Response) => {

    const file = `${req.query.path}.kr.json`;
    if (fs.existsSync(file)) {
        res.sendFile(file);
    } else {
        res.status(404).send("Knowledge Response file does not exist.")
    }

});

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