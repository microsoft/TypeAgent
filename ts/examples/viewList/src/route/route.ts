// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Server from "webpack-dev-server";
import fs from "fs";
import { getInstanceSessionsDirPath } from "agent-dispatcher/explorer";
import path from "node:path";

function getListFilePath() {
    const sessionsDir = getInstanceSessionsDirPath();
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

    return path.join(
        getInstanceSessionsDirPath(),
        sessions[0],
        "list",
        "lists.json",
    );
}

export function setupMiddlewares(
    middlewares: Server.Middleware[],
    devServer: Server,
) {
    const app = devServer.app!;
    let clients: any[] = [];

    // Get the lists file path from command-line arguments
    const listsFilePath = process.env.LISTS_FILE || getListFilePath();

    if (!listsFilePath || !fs.existsSync(listsFilePath)) {
        console.error(
            "There is no lists file in the current session. Make sure the Lists application agent is enabled.",
        );
        process.exit(1);
    }

    let listsData: { name: string; items: string[] }[] = [];

    const readListsFromFile = () => {
        fs.readFile(listsFilePath, "utf8", (err, data) => {
            if (err) {
                console.error("Error reading lists file:", err);
            } else {
                const updatedListsData = JSON.parse(data);
                const changes = compareListsData(listsData, updatedListsData);
                listsData = updatedListsData;
                sendEvent("updateLists", changes);
            }
        });
    };

    readListsFromFile();

    // Monitor the JSON file for changes
    fs.watch(listsFilePath, (eventType, filename) => {
        if (filename) {
            console.log(`File ${filename} changed: ${eventType}`);
            readListsFromFile();
        }
    });

    // Method to return all lists
    app.get("/lists", (req, res) => {
        res.json(listsData.map((list) => list.name));
    });

    // Method to return the contents of a list given its name
    app.get("/lists/:name", (req, res) => {
        const listName = req.params.name;
        const list = listsData.find((list) => list.name === listName);
        if (list) {
            res.json(list.items);
        } else {
            res.status(404).send("List not found");
        }
    });

    // SSE endpoint
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

    // Send events to all clients
    function sendEvent(event: string, data: any) {
        clients.forEach((client) => {
            client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        });
    }

    function compareListsData(
        current: { name: string; items: string[] }[],
        updated: { name: string; items: string[] }[],
    ) {
        const currentNames = current.map((list) => list.name);
        const updatedNames = updated.map((list) => list.name);

        const listsAdded = updatedNames.filter(
            (name) => !currentNames.includes(name),
        );
        const listsRemoved = currentNames.filter(
            (name) => !updatedNames.includes(name),
        );

        const listsEdited = updated
            .filter((updatedList) => {
                const currentList = current.find(
                    (list) => list.name === updatedList.name,
                );
                if (!currentList) return false;

                const itemsAdded = updatedList.items.filter(
                    (item) => !currentList.items.includes(item),
                );
                const itemsRemoved = currentList.items.filter(
                    (item) => !updatedList.items.includes(item),
                );
                const itemsEdited = updatedList.items.filter(
                    (item) =>
                        currentList.items.includes(item) &&
                        item !==
                            currentList.items[currentList.items.indexOf(item)],
                );

                return (
                    itemsAdded.length > 0 ||
                    itemsRemoved.length > 0 ||
                    itemsEdited.length > 0
                );
            })
            .map((updatedList) => {
                const currentList = current.find(
                    (list) => list.name === updatedList.name,
                );
                if (currentList) {
                    const itemsAdded = updatedList.items.filter(
                        (item) => !currentList.items.includes(item),
                    );
                    const itemsRemoved = currentList.items.filter(
                        (item) => !updatedList.items.includes(item),
                    );
                    const itemsEdited = updatedList.items.filter(
                        (item) =>
                            currentList.items.includes(item) &&
                            item !==
                                currentList.items[
                                    currentList.items.indexOf(item)
                                ],
                    );

                    return {
                        name: updatedList.name,
                        itemsAdded,
                        itemsRemoved,
                        itemsEdited,
                    };
                }
            });

        return { listsAdded, listsRemoved, listsEdited };
    }

    app.post("/add-list", (req, res) => {
        const newList = { name: "newList", items: [] };
        listsData.push(newList);
        sendEvent("addList", newList.name);
        res.sendStatus(200);
    });

    app.post("/add-item", (req, res) => {
        const listName = "weeklyGroceries";
        const newItem = "Oranges";
        const list = listsData.find((list) => list.name === listName);
        if (list) {
            list.items.push(newItem);
            sendEvent("addItem", { listName, newItem });
            res.sendStatus(200);
        } else {
            res.status(404).send("List not found");
        }
    });

    app.post("/remove-item", (req, res) => {
        const listName = "weeklyGroceries";
        const itemToRemove = "Bread";
        const list = listsData.find((list) => list.name === listName);
        if (list) {
            list.items = list.items.filter((item) => item !== itemToRemove);
            sendEvent("removeItem", { listName, itemToRemove });
            res.sendStatus(200);
        } else {
            res.status(404).send("List not found");
        }
    });

    app.post("/mark-ordered", (req, res) => {
        const listName = "weeklyGroceries";
        const itemToMark = "Milk";
        sendEvent("markOrdered", { listName, itemToMark });
        res.sendStatus(200);
    });

    return middlewares;
}
