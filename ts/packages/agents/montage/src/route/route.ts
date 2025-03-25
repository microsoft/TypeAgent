// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import Server from "webpack-dev-server";
import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";
import sharp from "sharp";
//import { getMimeType } from "common-utils";
import fs from "node:fs";

const app: Express = express();
const port = process.env.PORT || 9012;

// limit request rage
const limiter = rateLimit({
    windowMs: 1000,
    max: 1000, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Serve static content
const staticPath = fileURLToPath(new URL("../", import.meta.url));
app.use(express.static(staticPath));

// Accept JSON POST body data
app.use(bodyParser.json())

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

sharp.cache({ memory: 2048, files: 250, items: 1000 });

app.get("/thumbnail", async (req: Request, res: Response) => {

    console.log(req.url);
    const file: string = req.query.path as string;

    const thumbnail = `${file}.thumbnail.jpg`;
    if (!fs.existsSync(thumbnail)) {
        const img = sharp(file, { failOn: "error"}).resize(800, 800, { fit: "inside" }).withMetadata();
        try {
            await img.toFile(`${file}.thumbnail.jpg`);
        } catch (e) {
            console.log(e);
        }
    }

    // send the thumbnail if it's a valid size
    if (fs.statSync(thumbnail).size > 0) {
        res.sendFile(thumbnail);
    } else {
        res.sendFile(file);
    }

    // TOOD: figure out why this fails for most images
    // const img = sharp(file, { failOn: "error"}).resize(800, 800, { fit: "inside" }).withMetadata();
    //  const buffer = await img.toBuffer();
    
    // res.setHeader("Content-Type", getMimeType(path.extname(file)));
    // res.setHeader("Cache-Control", "no-cache");
    // res.setHeader("Connection", "keep-alive");
    // res.setHeader("Content-Length", buffer.byteLength);
    // res.flushHeaders(); 
        
    // res.write(buffer);
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

/**
 * Allows the client to send the updated montage data
 */
app.post("/montageUpdated", (req: Request, res: Response) => {
    res.status(200);
    res.send();

    // send the host process the montage data
    process.send?.(req.body);
});

let clients: any[] = [];
let messageQueue: any[] = [];
//let filePath: string;

app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.push(res);

    // drain any messages in the message queue
    while (messageQueue.length > 0) {
        sendDataToClients(messageQueue.shift());
    }

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

    // when no client is here just queue messages to drain later
    if (clients.length == 0) {
        messageQueue.push(message);
    } else {
        clients.forEach((client) => {
            client.write(`data: ${JSON.stringify(message)}\n\n`);
        });
    }
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