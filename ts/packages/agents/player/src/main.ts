// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import http from "http";
import { IClientContext, getClientContext, handleCall } from "./index.js";
import chalk from "chalk";
import { PlayerAction } from "./agent/playerSchema.js";

function chalkPlan(plan: PlayerAction) {
    console.log(chalk.green("Plan Validated:"));
    const lines = JSON.stringify(plan, null, 4).split("\n");
    for (let i = 0; i < lines.length; i++) {
        lines[i] = lines[i].replace(
            /"([^"]+)"(:?)|([0-9]+)/g,
            (match, word, colon, integer) => {
                if (integer) {
                    return chalk.hex("#B5CEA8")(integer);
                } else if (colon) {
                    return `"${chalk.cyan(word)}":`;
                } else {
                    return `"${chalk.rgb(181, 101, 29)(word)}"`;
                }
            },
        );
        console.log(lines[i]);
    }
}

// set this to false to just look at llm generation without Spotify connection
const spotifyConnect = true;

// Process requests interactively (no batch mode for now)
async function musicApp() {
    let context: IClientContext | undefined = undefined;
    if (spotifyConnect) {
        try {
            context = await getClientContext();
            console.log(
                `Logged in as ${context.service.retrieveUser().username}`,
            );
        } catch (e) {
            console.log(
                chalk.red(
                    `Error initializing Spotify connection: ${
                        (e as Error).message
                    }`,
                ),
            );
        }
    }

    if (context === undefined) {
        console.log(
            chalk.yellow("Spotify connection not active: showing plans only"),
        );
    }
    http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", async () => {
            console.log(body);
            const cmd = JSON.parse(body) as PlayerAction;
            chalkPlan(cmd);
            const reply = { action: cmd.actionName, result: "ok" };
            if (context !== undefined) {
                console.log("context is defined; spotify available");
            }
            console.log(
                chalk.greenBright(`Received command: ${cmd.actionName}`),
            );
            if (context !== undefined) {
                try {
                    await handleCall(cmd, context);
                } catch (e) {
                    console.log(
                        chalk.red(
                            `Error processing command: ${(e as Error).message}`,
                        ),
                    );
                }
            }
            res.end(JSON.stringify(reply));
        });
    }).listen(3027);
}

musicApp();
