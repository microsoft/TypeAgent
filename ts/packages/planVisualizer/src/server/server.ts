// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebPlanData, PlanNode, PlanLink, SSEEvent } from "../shared/types";
import { Request, Response } from "express";

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 9015;

// Type definitions for the server
interface Client extends Response {
    // Additional properties if needed for SSE clients
}

interface TransitionRequest {
    currentState: string;
    action: string;
    nodeType: string;
}

interface TitleRequest {
    title: string;
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
            label: "Is Order Complete?",
        },
        { source: "orderCheck", target: "checkout", label: "Yes" },
        { source: "orderCheck", target: "userCheck", label: "No" },
        { source: "userCheck", target: "searchResults", label: "Add Items" },
        { source: "userCheck", target: "checkout", label: "Approve Partial" },
        { source: "checkout", target: "payment" },
        { source: "payment", target: "confirmation" },
    ],
    currentNode: "start",
    title: "Static Plan",
};

// Middleware
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Track connected SSE clients
const clients: Set<Client> = new Set();

// Serve the main visualization page
app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// SSE endpoint for real-time updates
app.get("/api/events", (req: Request, res: Response) => {
    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    // Add client to the set
    const client = res as Client;
    clients.add(client);

    // Handle client disconnect
    req.on("close", () => {
        clients.delete(client);
    });
});

// Function to send an update to all connected clients
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

// API endpoint to get the current plan data
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
    } = req.body as TransitionRequest;

    let sourceNodeId: string;
    let targetNodeId: string;

    const isFirstNode = dynamicPlanData.nodes.length === 0;

    // Case 1: Replacing a temporary node
    const tempNodeIndex = dynamicPlanData.nodes.findIndex(
        (node) => node.isTemporary,
    );
    if (tempNodeIndex >= 0) {
        // Replace the temporary node with the confirmed state
        const tempNode = dynamicPlanData.nodes[tempNodeIndex];

        // Update the temporary node to be a confirmed state
        // If currentState is empty and this is the first node, label it "Start"
        tempNode.label =
            isFirstNode && !currentState ? "Start" : currentState || "";
        tempNode.isTemporary = false;
        tempNode.type = isFirstNode ? "start" : nodeType;

        sourceNodeId = tempNode.id;
    } else {
        // Case 2: No temporary node to replace, just use/create the current state
        // Allow blank state names to create unnamed states
        const existingNode = currentState
            ? dynamicPlanData.nodes.find((node) => node.label === currentState)
            : null;

        if (existingNode) {
            sourceNodeId = existingNode.id;
        } else {
            // This is the first node or a new branch
            sourceNodeId = `node-${dynamicPlanData.nodes.length}`;

            // If this is the first node and label is empty, use "Start"
            const nodeLabel =
                isFirstNode && !currentState ? "Start" : currentState || "";

            dynamicPlanData.nodes.push({
                id: sourceNodeId,
                label: nodeLabel,
                type: isFirstNode ? "start" : nodeType,
                isTemporary: false,
            });
        }
    }

    // If action is empty, this is an end state with no outgoing transitions
    if (!action || action.trim() === "") {
        // Just update the current node without creating a new transition
        dynamicPlanData.currentNode = sourceNodeId;

        // If this is an end state, mark it as such
        const sourceNode = dynamicPlanData.nodes.find(
            (node) => node.id === sourceNodeId,
        );
        if (sourceNode) {
            sourceNode.type = "end";
        }

        broadcastUpdate("transition", dynamicPlanData);
        res.json(dynamicPlanData);
        return;
    }

    // Create a new temporary node with blank label (not using action name)
    targetNodeId = `node-${dynamicPlanData.nodes.length}`;
    dynamicPlanData.nodes.push({
        id: targetNodeId,
        label: "", // Blank label for temporary nodes
        type: "temporary",
        isTemporary: true,
    });

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

// Modify your reset endpoint to preserve title if requested
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

app.listen(port, () => {
    console.log(
        `Web Plan Visualizer server running at http://localhost:${port}`,
    );
});
