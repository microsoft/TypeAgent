import Server from "webpack-dev-server";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setupMiddlewares(
    middlewares: Server.Middleware[],
    devServer: Server,
) {
    const app = devServer.app!;
    // const port = 3000;

    let clients: any[] = [];

    // Serve static files from the "public" directory
    // app.use(express.static(path.join(__dirname, 'public')));

    // Get the lists file path from command-line arguments
    // const listsFilePath = process.argv[0] || path.join(__dirname, "lists.json");
    const listsFilePath = path.join(__dirname, "lists.json");
    let listsData: { name: string; items: string[] }[] = [];

    const readListsFromFile = () => {
        fs.readFile(listsFilePath, "utf8", (err, data) => {
            if (err) {
                console.error("Error reading lists file:", err);
            } else {
                listsData = JSON.parse(data);
            }
        });
    };

    readListsFromFile();

    // Monitor the JSON file for changes
    fs.watch(listsFilePath, (eventType, filename) => {
        if (filename) {
            console.log(`File ${filename} changed: ${eventType}`);
            readListsFromFile();
            sendEvent("updateLists", listsData);
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

    // Function to send events to all clients
    function sendEvent(event: string, data: any) {
        clients.forEach((client) => {
            client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        });
    }

    // Example of adding a list
    app.post("/add-list", (req, res) => {
        const newList = { name: "newList", items: [] };
        listsData.push(newList);
        sendEvent("addList", newList.name);
        res.sendStatus(200);
    });

    // Example of adding an item to a list
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

    // Example of removing an item from a list
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

    // Example of marking an item as ordered
    app.post("/mark-ordered", (req, res) => {
        const listName = "weeklyGroceries";
        const itemToMark = "Milk";
        sendEvent("markOrdered", { listName, itemToMark });
        res.sendStatus(200);
    });

    // Start the server
    /*
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
*/
    return middlewares;
}
