// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import express, { Request, Response } from "express";
import { AgentCache, AgentCacheFactory, MatchResult, RequestAction } from "agent-cache";
import { existsSync } from "fs";
import path from "path";


// Create an instance of an Express application
const app = express();

// Define the port number
const port = `10482`;

// The cache file to serve
const cacheFile = './data/v5_sample.json';

// the cache
let agentCache: AgentCache;

// Set up a route for the root URL ('/')
app.get('/', async (req: Request, res: Response) => {
    //res.send(`Hello World! ${req} ${res}`);

    const s = req.query['s'];

    if (s) {
        console.log(`Received request with s=${s}`);

        const matches: MatchResult[] = await agentCache.constructionStore.match(s as string, {});
        if (matches.length > 0) {
            const hits: RequestAction[] = [];

            matches.forEach((construction) => {
                hits.push(construction.match);
            });

            res.send(`${JSON.stringify(hits, null, 0)}`);
        } else {
            res.status(404).send("{ \"error\": \"No matches found.\" }");
        }

    } else {
        res.status(400).send("{ \"error\": \"Please provide a query parameter 's' containing the cache entry to check.\" }");
    }
});

app.get(`/test`, async (req: Request, res: Response) => {
    res.sendFile(path.resolve("src/test.html"));
});

// Start the server and listen on the specified port
app.listen(port, async () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log(`Serving cache file from: ${cacheFile}`);

    const cacheFactory = new AgentCacheFactory();
    agentCache = cacheFactory.create();

    if (existsSync(cacheFile)) {
        await agentCache.constructionStore.load(cacheFile);
    } else {
        throw new Error(`Cache file does not exist: ${cacheFile}`);
        process.exit(1);
    }

});
