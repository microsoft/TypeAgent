// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebPlanData, PlanNode } from "./plansTypes.js";

/**
 * Plans business logic service
 */
export class PlansService {
    private dynamicPlanData!: WebPlanData;
    private staticPlanData!: WebPlanData;
    private requestCounter: number = 0;
    private pendingRequests: Map<
        string,
        {
            resolve: Function;
            reject: Function;
            timeout: NodeJS.Timeout;
        }
    > = new Map();

    constructor() {
        this.initializePlanData();
        this.setupIPCConnection();
    }

    /**
     * Setup IPC connection with agent service
     */
    private setupIPCConnection(): void {
        process.on("message", (message: any) => {
            this.handleIPCMessage(message);
        });
    }

    /**
     * Handle IPC messages from agent service
     */
    private handleIPCMessage(message: any): void {
        if (message.type === "getActionResponse") {
            const pending = this.pendingRequests.get(message.requestId);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(message.requestId);

                if (message.success) {
                    pending.resolve(message.action);
                } else {
                    pending.reject(new Error(message.error || "Unknown error"));
                }
            }
        }
    }

    /**
     * Send IPC request to agent service
     */
    private async sendIPCRequest(
        type: string,
        data: any,
        timeoutMs: number = 5000,
    ): Promise<any> {
        const requestId = `req-${++this.requestCounter}-${Date.now()}`;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error("IPC request timeout"));
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timeout });

            if (process.send) {
                process.send({
                    type,
                    requestId,
                    ...data,
                });
            } else {
                clearTimeout(timeout);
                this.pendingRequests.delete(requestId);
                reject(new Error("IPC not available"));
            }
        });
    }

    /**
     * Initialize plan data with default values
     */
    private initializePlanData(): void {
        // Initial dynamic web plan data
        this.dynamicPlanData = {
            nodes: [],
            links: [],
            currentNode: null,
            title: "Dynamic Plan",
        };

        // Sample static web plan data
        this.staticPlanData = {
            nodes: [
                { id: "start", label: "Home", type: "start" },
                {
                    id: "searchResults",
                    label: "Search Results",
                    type: "action",
                },
                { id: "details", label: "Product Details", type: "action" },
                { id: "addToCart", label: "Cart", type: "action" },
                {
                    id: "orderCheck",
                    label: "Is Order Complete?",
                    type: "decision",
                },
                { id: "userCheck", label: "Check with User", type: "action" },
                { id: "checkout", label: "Checkout", type: "action" },
                { id: "payment", label: "Payment", type: "action" },
                {
                    id: "confirmation",
                    label: "Order Confirmation",
                    type: "end",
                },
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
                {
                    source: "details",
                    target: "addToCart",
                    label: "Add Items to Cart",
                },
                {
                    source: "addToCart",
                    target: "orderCheck",
                    label: "Evaluate order state",
                },
                { source: "orderCheck", target: "checkout", label: "Yes" },
                { source: "orderCheck", target: "userCheck", label: "No" },
                {
                    source: "userCheck",
                    target: "stopOrder",
                    label: "Drop order",
                },
                {
                    source: "userCheck",
                    target: "checkout",
                    label: "Approve Partial",
                },
                { source: "checkout", target: "payment" },
                { source: "payment", target: "confirmation" },
            ],
            currentNode: "start",
            title: "Static Plan",
        };
    }

    /**
     * Get plan data by view mode
     */
    getPlan(viewMode: string = "dynamic"): WebPlanData {
        if (viewMode === "static") {
            return this.staticPlanData;
        }
        return this.dynamicPlanData;
    }
    /**
     * Add a new state transition
     */
    addTransition(request: {
        currentState: string;
        action: string;
        nodeType?: string;
        screenshot?: string;
    }): WebPlanData {
        const {
            currentState,
            action,
            nodeType = "action",
            screenshot = null,
        } = request;

        let sourceNodeId: string;
        let targetNodeId: string;

        const isFirstNode = this.dynamicPlanData.nodes.length === 0;

        // Case 0: If both currentState and action are empty, throw error
        if (!currentState && !action) {
            throw new Error("Either state name or action must be provided");
        }

        // Case 1: Only currentState is provided (no action)
        if (currentState && !action) {
            // Case 1.1: Check if the state already exists
            const existingNode = this.dynamicPlanData.nodes.find(
                (node: PlanNode) =>
                    node.label === currentState && !node.isTemporary,
            );

            if (existingNode) {
                // If the state exists, set it as the current node
                this.dynamicPlanData.currentNode = existingNode.id;

                // Apply screenshot if provided
                if (screenshot) {
                    existingNode.screenshot = screenshot;
                }

                return this.dynamicPlanData;
            }

            // Case 1.2: If there's a temporary node, replace it with this state
            const tempNodeIndex = this.dynamicPlanData.nodes.findIndex(
                (node: PlanNode) => node.isTemporary,
            );

            if (tempNodeIndex >= 0) {
                // Replace the temporary node with the confirmed state
                const tempNode = this.dynamicPlanData.nodes[tempNodeIndex];

                // Update the temporary node to be a confirmed state
                tempNode.label = currentState;
                tempNode.isTemporary = false;
                tempNode.type = isFirstNode ? "start" : nodeType;

                // Apply screenshot if provided
                if (screenshot) {
                    tempNode.screenshot = screenshot;
                }

                // Set it as the current node
                this.dynamicPlanData.currentNode = tempNode.id;

                return this.dynamicPlanData;
            }

            // Case 1.3: If this is the first node or we need to create a new one
            sourceNodeId = `node-${this.dynamicPlanData.nodes.length}`;

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

            this.dynamicPlanData.nodes.push(newNode);

            // Set it as the current node
            this.dynamicPlanData.currentNode = sourceNodeId;

            return this.dynamicPlanData;
        }
        // Case 2: Only action is provided (no currentState)
        if (!currentState && action) {
            // We must have a current node to add an action from
            if (!this.dynamicPlanData.currentNode) {
                throw new Error(
                    "No current node selected. Please set a state first.",
                );
            }

            // Use the current node as the source
            sourceNodeId = this.dynamicPlanData.currentNode;

            // Update screenshot on source node if provided
            if (screenshot) {
                const sourceNode = this.dynamicPlanData.nodes.find(
                    (n: PlanNode) => n.id === sourceNodeId,
                );
                if (sourceNode) {
                    sourceNode.screenshot = screenshot;
                }
            }

            // Create a new temporary node as the target
            targetNodeId = `node-${this.dynamicPlanData.nodes.length}`;

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

            this.dynamicPlanData.nodes.push(tempNode);

            // Create the link with the action name
            this.dynamicPlanData.links.push({
                source: sourceNodeId,
                target: targetNodeId,
                label: action,
            });

            // Update current node to the new temporary node
            this.dynamicPlanData.currentNode = targetNodeId;

            return this.dynamicPlanData;
        }

        // Case 3: Both currentState and action are provided (original behavior)
        // Case 3.1: Replacing a temporary node
        const tempNodeIndex = this.dynamicPlanData.nodes.findIndex(
            (node: PlanNode) => node.isTemporary,
        );

        if (tempNodeIndex >= 0) {
            // Replace the temporary node with the confirmed state
            const tempNode = this.dynamicPlanData.nodes[tempNodeIndex];

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
                ? this.dynamicPlanData.nodes.find(
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
                sourceNodeId = `node-${this.dynamicPlanData.nodes.length}`;

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

                this.dynamicPlanData.nodes.push(newNode);
            }
        }

        // Create a new temporary node with blank label
        targetNodeId = `node-${this.dynamicPlanData.nodes.length}`;

        // Create temporary node
        const newTempNode: PlanNode = {
            id: targetNodeId,
            label: "", // Blank label for temporary nodes
            type: "temporary",
            isTemporary: true,
        };

        this.dynamicPlanData.nodes.push(newTempNode);

        // Create the link with the action name
        this.dynamicPlanData.links.push({
            source: sourceNodeId,
            target: targetNodeId,
            label: action,
        });

        // Update current node
        this.dynamicPlanData.currentNode = targetNodeId;

        return this.dynamicPlanData;
    }
    /**
     * Update plan title
     */
    updateTitle(title: string, mode: string = "dynamic"): WebPlanData {
        if (!title) {
            throw new Error("Title is required");
        }

        if (mode === "static") {
            this.staticPlanData.title = title;
            return this.staticPlanData;
        } else {
            this.dynamicPlanData.title = title;
            return this.dynamicPlanData;
        }
    }

    /**
     * Update node screenshot
     */
    updateScreenshot(nodeId: string, screenshot: string): WebPlanData {
        if (!nodeId || !screenshot) {
            throw new Error("Node ID and screenshot are required");
        }

        // Find the node in both dynamic and static plan data
        const dynamicNode = this.dynamicPlanData.nodes.find(
            (node: PlanNode) => node.id === nodeId,
        );
        const staticNode = this.staticPlanData.nodes.find(
            (node: PlanNode) => node.id === nodeId,
        );

        // Update the node if found
        if (dynamicNode) {
            dynamicNode.screenshot = screenshot;
            return this.dynamicPlanData;
        }

        if (staticNode) {
            staticNode.screenshot = screenshot;
            return this.staticPlanData;
        }

        throw new Error("Node not found");
    }

    /**
     * Get action data by ID from agent service
     */
    async getActionData(actionId: string): Promise<{
        action: any;
        planData: WebPlanData;
    } | null> {
        try {
            const action = await this.sendIPCRequest("getAction", { actionId });

            if (!action) {
                return null;
            }

            if (!action.definition?.actionsJson) {
                return {
                    action,
                    planData: this.createEmptyPlan(action.name),
                };
            }

            const planData = this.convertPageActionsPlanToWebPlan(
                action.definition.actionsJson,
                action.name,
            );

            return { action, planData };
        } catch (error) {
            console.error("Error retrieving action data:", error);
            throw error;
        }
    }

    /**
     * Create empty plan for actions without plan data
     */
    private createEmptyPlan(actionName: string): WebPlanData {
        return {
            nodes: [
                { id: "start", label: "Home", type: "start" },
                { id: "action", label: actionName, type: "end" },
            ],
            links: [{ source: "start", target: "action", label: "Execute" }],
            currentNode: "start",
            title: actionName,
        };
    }

    /**
     * Convert PageActionsPlan to WebPlanData format
     */
    private convertPageActionsPlanToWebPlan(
        pageActionsPlan: any,
        actionName: string,
    ): WebPlanData {
        const nodes: any[] = [];
        const links: any[] = [];

        // Create start node with label "Home"
        nodes.push({
            id: "start",
            label: "Home",
            type: "start",
        });

        if (pageActionsPlan.steps && Array.isArray(pageActionsPlan.steps)) {
            pageActionsPlan.steps.forEach((step: any, index: number) => {
                const nodeId = `step-${index}`;
                const isLastStep = index === pageActionsPlan.steps.length - 1;

                nodes.push({
                    id: nodeId,
                    label: isLastStep ? "Completed" : "",
                    type: isLastStep ? "end" : "action",
                });

                // Create edge label from step description or fallback to actionName + parameter
                let edgeLabel = step.description;
                if (!edgeLabel && step.actionName) {
                    if (step.parameters?.valueTextParameter) {
                        edgeLabel = `${step.actionName} (${step.parameters.valueTextParameter})`;
                    } else {
                        edgeLabel = step.actionName;
                    }
                }

                const sourceId = index === 0 ? "start" : `step-${index - 1}`;
                links.push({
                    source: sourceId,
                    target: nodeId,
                    label: edgeLabel || "Action",
                });
            });
        } else {
            // Fallback for actions without steps
            nodes.push({
                id: "action",
                label: pageActionsPlan.planName || actionName,
                type: "end",
            });

            links.push({
                source: "start",
                target: "action",
                label: "Execute",
            });
        }

        return {
            nodes,
            links,
            currentNode: "start",
            title: pageActionsPlan.planName || actionName,
            description: pageActionsPlan.description,
        };
    }

    /**
     * Reset dynamic plan data
     */
    reset(preserveTitle: boolean = false): WebPlanData {
        const currentTitle = this.dynamicPlanData.title;

        this.dynamicPlanData = {
            nodes: [],
            links: [],
            currentNode: null,
            title: preserveTitle ? currentTitle : "Dynamic Plan",
        };

        return this.dynamicPlanData;
    }
}
