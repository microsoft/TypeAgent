// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { WebPlanData, PlanNode, SSEEvent } from "../shared/types.js";
import { Request, Response } from "express";
import registerDebug from "debug";

const debug = registerDebug("typeagent:agent:planVisualizer:server");

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const port = parseInt(process.argv[2]);
if (isNaN(port)) {
    throw new Error("Port must be a number");
}

// Type definitions for the server
interface Client extends Response {}

interface TransitionRequest {
    currentState: string;
    action: string;
    nodeType: string;
    screenshot?: string;
}

interface TitleRequest {
    title: string;
}

interface ScreenshotRequest {
    nodeId: string;
    screenshot: string; // Base64-encoded screenshot
}

// Initial web plan data (will be modified by API calls)
let dynamicPlanData: WebPlanData = {
    nodes: [],
    links: [],
    currentNode: null,
    title: "Dynamic Plan",
};

// Sample static web plan data
const staticPlanData: WebPlanData = {
    nodes: [
        { id: "start", label: "Home", type: "start" },
        { id: "searchResults", label: "Search Results", type: "action" },
        { id: "details", label: "Product Details", type: "action" },
        { id: "addToCart", label: "Cart", type: "action" },
        { id: "orderCheck", label: "Is Order Complete?", type: "decision" },
        { id: "userCheck", label: "Check with User", type: "action" },
        { id: "checkout", label: "Checkout", type: "action" },
        { id: "payment", label: "Payment", type: "action" },
        { id: "confirmation", label: "Order Confirmation", type: "end" },
        { id: "stopOrder", label: "Abandon order", type: "end" },
    ],
    links: [
        {
            source: "start",
            target: "searchResults",
            label: "Search for Product",
        },
        {
            source: "searchResults",
            target: "details",
            label: "Open Product Details",
        },
        { source: "details", target: "addToCart", label: "Add Items to Cart" },
        {
            source: "addToCart",
            target: "orderCheck",
            label: "Evaluate order state",
        },
        { source: "orderCheck", target: "checkout", label: "Yes" },
        { source: "orderCheck", target: "userCheck", label: "No" },
        { source: "userCheck", target: "stopOrder", label: "Drop order" },
        { source: "userCheck", target: "checkout", label: "Approve Partial" },
        { source: "checkout", target: "payment" },
        { source: "payment", target: "confirmation" },
    ],
    currentNode: "start",
    title: "Static Plan",
};

// Middleware
const limiter = rateLimit({
    windowMs: 60000,
    max: 100,
});

app.use(limiter);
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Track connected SSE clients
const clients: Set<Client> = new Set();

// Serve the main visualization page
app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});
app.get("/plans/", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/api/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    const client = res as Client;
    clients.add(client);

    req.on("close", () => {
        clients.delete(client);
    });
});

function broadcastUpdate(updateType: string, data: WebPlanData): void {
    const eventData: SSEEvent = {
        type: updateType,
        data: data,
        timestamp: new Date().toISOString(),
    };

    const eventString = `data: ${JSON.stringify(eventData)}\n\n`;

    clients.forEach((client) => {
        client.write(eventString);
    });
}

app.get("/api/plan", (req: Request, res: Response) => {
    const viewMode = req.query.mode || "dynamic";
    if (viewMode === "static") {
        res.json(staticPlanData);
    } else {
        res.json(dynamicPlanData);
    }
});

// API endpoint to add a new state transition
app.post("/api/transition", (req: Request, res: Response) => {
    const {
        currentState,
        action,
        nodeType = "action",
        screenshot = null,
    } = req.body as TransitionRequest & { screenshot?: string };

    let sourceNodeId: string;
    let targetNodeId: string;

    const isFirstNode = dynamicPlanData.nodes.length === 0;

    // Case 0: If both currentState and action are empty, return an error
    if (!currentState && !action) {
        return res.status(400).json({
            error: "Either state name or action must be provided",
        });
    }

    // Case 1: Only currentState is provided (no action)
    if (currentState && !action) {
        // Case 1.1: Check if the state already exists
        const existingNode = dynamicPlanData.nodes.find(
            (node: PlanNode) =>
                node.label === currentState && !node.isTemporary,
        );

        if (existingNode) {
            // If the state exists, set it as the current node
            dynamicPlanData.currentNode = existingNode.id;

            // Apply screenshot if provided
            if (screenshot) {
                existingNode.screenshot = screenshot;
            }

            broadcastUpdate("transition", dynamicPlanData);
            return res.json(dynamicPlanData);
        }

        // Case 1.2: If there's a temporary node, replace it with this state
        const tempNodeIndex = dynamicPlanData.nodes.findIndex(
            (node: PlanNode) => node.isTemporary,
        );

        if (tempNodeIndex >= 0) {
            // Replace the temporary node with the confirmed state
            const tempNode = dynamicPlanData.nodes[tempNodeIndex];

            // Update the temporary node to be a confirmed state
            tempNode.label = currentState;
            tempNode.isTemporary = false;
            tempNode.type = isFirstNode ? "start" : nodeType;

            // Apply screenshot if provided
            if (screenshot) {
                tempNode.screenshot = screenshot;
            }

            // Set it as the current node
            dynamicPlanData.currentNode = tempNode.id;

            broadcastUpdate("transition", dynamicPlanData);
            return res.json(dynamicPlanData);
        }

        // Case 1.3: If this is the first node or we need to create a new one
        sourceNodeId = `node-${dynamicPlanData.nodes.length}`;

        // If this is the first node, use "Start" type
        const newNode: PlanNode = {
            id: sourceNodeId,
            label: currentState,
            type: isFirstNode ? "start" : nodeType,
            isTemporary: false,
        };

        // Apply screenshot if provided
        if (screenshot) {
            newNode.screenshot = screenshot;
        }

        dynamicPlanData.nodes.push(newNode);

        // Set it as the current node
        dynamicPlanData.currentNode = sourceNodeId;

        broadcastUpdate("transition", dynamicPlanData);
        return res.json(dynamicPlanData);
    }

    // Case 2: Only action is provided (no currentState)
    if (!currentState && action) {
        // We must have a current node to add an action from
        if (!dynamicPlanData.currentNode) {
            return res.status(400).json({
                error: "No current node selected. Please set a state first.",
            });
        }

        // Use the current node as the source
        sourceNodeId = dynamicPlanData.currentNode;

        // Update screenshot on source node if provided
        if (screenshot) {
            const sourceNode = dynamicPlanData.nodes.find(
                (n: PlanNode) => n.id === sourceNodeId,
            );
            if (sourceNode) {
                sourceNode.screenshot = screenshot;
            }
        }

        // Create a new temporary node as the target
        targetNodeId = `node-${dynamicPlanData.nodes.length}`;

        // Create new temporary node with screenshot if provided
        const tempNode: PlanNode = {
            id: targetNodeId,
            label: "", // Blank label for temporary nodes
            type: "temporary",
            isTemporary: true,
        };

        // Apply screenshot if provided (to the new temporary node)
        if (screenshot) {
            tempNode.screenshot = screenshot;
        }

        dynamicPlanData.nodes.push(tempNode);

        // Create the link with the action name
        dynamicPlanData.links.push({
            source: sourceNodeId,
            target: targetNodeId,
            label: action,
        });

        // Update current node to the new temporary node
        dynamicPlanData.currentNode = targetNodeId;

        broadcastUpdate("transition", dynamicPlanData);
        return res.json(dynamicPlanData);
    }

    // Case 3: Both currentState and action are provided (original behavior)
    // Case 3.1: Replacing a temporary node
    const tempNodeIndex = dynamicPlanData.nodes.findIndex(
        (node: PlanNode) => node.isTemporary,
    );

    if (tempNodeIndex >= 0) {
        // Replace the temporary node with the confirmed state
        const tempNode = dynamicPlanData.nodes[tempNodeIndex];

        // Update the temporary node to be a confirmed state
        tempNode.label = currentState || "";
        tempNode.isTemporary = false;
        tempNode.type = isFirstNode ? "start" : nodeType;

        // Apply screenshot if provided
        if (screenshot) {
            tempNode.screenshot = screenshot;
        }

        sourceNodeId = tempNode.id;
    } else {
        // Case 3.2: No temporary node to replace, use/create the current state
        const existingNode = currentState
            ? dynamicPlanData.nodes.find(
                  (node: PlanNode) => node.label === currentState,
              )
            : null;

        if (existingNode) {
            sourceNodeId = existingNode.id;

            // Apply screenshot to existing node if provided
            if (screenshot) {
                existingNode.screenshot = screenshot;
            }
        } else {
            // This is the first node or a new branch
            sourceNodeId = `node-${dynamicPlanData.nodes.length}`;

            // If this is the first node and label is empty, use "Start"
            const nodeLabel =
                isFirstNode && !currentState ? "Start" : currentState || "";

            // Create a new node with the screenshot if provided
            const newNode: PlanNode = {
                id: sourceNodeId,
                label: nodeLabel,
                type: isFirstNode ? "start" : nodeType,
                isTemporary: false,
            };

            // Apply screenshot if provided
            if (screenshot) {
                newNode.screenshot = screenshot;
            }

            dynamicPlanData.nodes.push(newNode);
        }
    }

    // Create a new temporary node with blank label
    targetNodeId = `node-${dynamicPlanData.nodes.length}`;

    // Create temporary node
    const newTempNode: PlanNode = {
        id: targetNodeId,
        label: "", // Blank label for temporary nodes
        type: "temporary",
        isTemporary: true,
    };

    // We don't apply screenshot to the temporary node in this case,
    // as we want it on the source node that we just confirmed

    dynamicPlanData.nodes.push(newTempNode);

    // Create the link with the action name
    dynamicPlanData.links.push({
        source: sourceNodeId,
        target: targetNodeId,
        label: action,
    });

    // Update current node
    dynamicPlanData.currentNode = targetNodeId;

    broadcastUpdate("transition", dynamicPlanData);
    res.json(dynamicPlanData);
});

// API endpoint to set the plan title
app.post("/api/title", (req: Request, res: Response) => {
    const { title } = req.body as TitleRequest;
    const mode = req.query.mode || "dynamic";

    if (!title) {
        return res.status(400).json({ error: "Title is required" });
    }

    if (mode === "static") {
        staticPlanData.title = title;
        broadcastUpdate("title", staticPlanData);
        res.json(staticPlanData);
    } else {
        dynamicPlanData.title = title;
        broadcastUpdate("title", dynamicPlanData);
        res.json(dynamicPlanData);
    }
});

// API endpoint to set a screenshot for a node
app.post("/api/screenshot", (req: Request, res: Response) => {
    const { nodeId, screenshot } = req.body as ScreenshotRequest;

    if (!nodeId || !screenshot) {
        return res
            .status(400)
            .json({ error: "Node ID and screenshot are required" });
    }

    // Find the node in both dynamic and static plan data
    const dynamicNode = dynamicPlanData.nodes.find(
        (node: PlanNode) => node.id === nodeId,
    );
    const staticNode = staticPlanData.nodes.find(
        (node: PlanNode) => node.id === nodeId,
    );

    // Update the node if found
    if (dynamicNode) {
        dynamicNode.screenshot = screenshot;
        broadcastUpdate("node-update", dynamicPlanData);
    }

    if (staticNode) {
        staticNode.screenshot = screenshot;
        broadcastUpdate("node-update", staticPlanData);
    }

    if (!dynamicNode && !staticNode) {
        return res.status(404).json({ error: "Node not found" });
    }

    // Return the updated plan data
    const currentPlanData = dynamicNode ? dynamicPlanData : staticPlanData;
    res.json(currentPlanData);
});

app.post("/api/reset", (req: Request, res: Response) => {
    const preserveTitle = req.query.preserveTitle === "true";
    const currentTitle = dynamicPlanData.title;

    dynamicPlanData = {
        nodes: [],
        links: [],
        currentNode: null,
        title: preserveTitle ? currentTitle : "Dynamic Plan",
    };

    broadcastUpdate("reset", dynamicPlanData);

    res.json(dynamicPlanData);
});

process.send?.("Success");

process.on("message", (message: any) => {});

process.on("disconnect", () => {
    process.exit(1);
});

app.listen(port, () => {
    debug(`Web Plan Visualizer server running at http://localhost:${port}`);
});
