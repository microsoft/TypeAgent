// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Interface for the web plan data structure
 */
export interface WebPlanData {
    nodes: WebPlanNode[];
    links: WebPlanLink[];
    currentNode: string | null;
    title?: string; // Optional title property
}

/**
 * Interface for a node in the web plan
 */
export interface WebPlanNode {
    id: string;
    label: string;
    type: "start" | "action" | "decision" | "end" | "temporary";
    isTemporary?: boolean;
    screenshot?: string; // Base64-encoded screenshot
}

/**
 * Interface for a link between nodes in the web plan
 */
export interface WebPlanLink {
    source: string;
    target: string;
    label: string;
}

/**
 * Interface for transition submission data
 */
export interface TransitionData {
    currentState: string;
    action: string;
    nodeType?: "action" | "decision" | "end" | undefined;
    screenshot?: string | undefined; // Base64-encoded screenshot
}

/**
 * Interface for screenshot submission data
 */
export interface ScreenshotData {
    nodeId: string;
    screenshot: string; // Base64-encoded screenshot
}

/**
 * Client for interacting with the Web Plan Visualizer API
 */
export class VisualizerClient {
    private currentPlan: WebPlanData | null = null;

    /**
     * Create a new visualizer client
     * @param baseUrl The base URL of the visualizer server
     */
    constructor(private baseUrl: string) {}

    /**
     * Helper method to handle fetch requests
     * @param endpoint API endpoint
     * @param options Fetch options
     * @returns Promise resolving to the parsed response
     */
    private async fetchApi<T>(
        endpoint: string,
        options?: RequestInit,
    ): Promise<T | null> {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, options);

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return (await response.json()) as T;
        } catch (error) {
            // console.error(`Error fetching ${endpoint}:`, error);
            return null;
        }
    }

    /**
     * Get the current plan data
     * @param mode The view mode (static or dynamic)
     * @returns Promise resolving to the plan data
     */
    async getPlan(
        mode: "static" | "dynamic" | "screenshot" = "dynamic",
    ): Promise<WebPlanData | null> {
        const data = await this.fetchApi<WebPlanData>(
            `/api/plans/plan?mode=${mode}`,
        );

        if (!data) {
            return null;
        }

        this.currentPlan = data;
        return data;
    }

    /**
     * Add a transition to the plan
     * @param data The transition data
     * @returns Promise resolving to the updated plan data
     */
    async addTransition(data: TransitionData): Promise<WebPlanData | null> {
        const updatedPlan = await this.fetchApi<WebPlanData | null>(
            "/api/plans/transition",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(data),
            },
        );
        if (!updatedPlan) {
            return null;
        }

        this.currentPlan = updatedPlan;
        return updatedPlan;
    }

    /**
     * Upload a screenshot for a specific node
     * @param nodeId The ID of the node to add a screenshot to
     * @param screenshot Base64-encoded screenshot data
     * @returns Promise resolving to the updated plan data
     */
    async uploadScreenshot(
        nodeId: string,
        screenshot: string,
    ): Promise<WebPlanData | null> {
        const updatedPlan = await this.fetchApi<WebPlanData>(
            "/api/plans/screenshot",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    nodeId,
                    screenshot,
                }),
            },
        );
        if (!updatedPlan) {
            return null;
        }
        this.currentPlan = updatedPlan;
        return updatedPlan;
    }

    /**
     * Find a node by its label
     * @param label The label of the node to find
     * @returns The node ID if found, null otherwise
     */
    findNodeIdByLabel(label: string): string | null {
        if (!this.currentPlan) return null;

        const node = this.currentPlan.nodes.find((n) => n.label === label);
        return node ? node.id : null;
    }

    /**
     * Reset the plan to its initial state
     * @returns Promise resolving to the reset plan data
     */
    async resetPlan(): Promise<WebPlanData | null> {
        const resetPlan = await this.fetchApi<WebPlanData>("/api/plans/reset", {
            method: "POST",
        });

        if (!resetPlan) {
            return null;
        }

        this.currentPlan = resetPlan;
        return resetPlan;
    }

    /**
     * Set the title of the current plan
     * @param title The title to set
     * @returns Promise resolving to the updated plan data
     */
    async setPlanTitle(title: string): Promise<WebPlanData | null> {
        const updatedPlan = await this.fetchApi<WebPlanData>(
            "/api/plans/title",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ title }),
            },
        );

        if (!updatedPlan) {
            return null;
        }

        this.currentPlan = updatedPlan;
        return updatedPlan;
    }

    /**
     * Get the current plan data without making an API call
     * @returns The current plan data or null if not fetched yet
     */
    getCurrentPlan(): WebPlanData | null {
        return this.currentPlan;
    }
}

/**
 * A higher-level state machine tracker to simplify adding states and transitions
 */
export class StateMachineTracker {
    private client: VisualizerClient;
    private currentStateName: string | null = null;
    private planTitle: string = "Untitled Plan";
    private screenShots = new Map<string, string>(); // Map state names to screenshots

    /**
     * Create a new state machine tracker
     * @param baseUrl The base URL of the visualizer server
     * @param title Optional title for the plan
     */
    constructor(baseUrl: string, title?: string) {
        this.client = new VisualizerClient(baseUrl);
        if (title) {
            this.planTitle = title;
            // Set title asynchronously, don't wait
            this.client
                .setPlanTitle(title)
                .catch((e) => console.error("Failed to set initial title:", e));
        }
    }

    /**
     * Get the current state name
     * @returns The current state name or null if no state has been set
     */
    get currentState(): string | null {
        return this.currentStateName;
    }

    /**
     * Set the title of the state machine visualization
     * @param title The title to set
     * @returns Promise resolving when title is set
     */
    async setTitle(title: string): Promise<void> {
        this.planTitle = title;
        await this.client.setPlanTitle(title);
    }

    /**
     * Reset the state machine
     * @param keepTitle Whether to keep the current title (default: true)
     * @returns Promise resolving when reset is complete
     */
    async reset(keepTitle: boolean = true): Promise<void> {
        await this.client.resetPlan();
        this.currentStateName = null;
        this.screenShots.clear(); // Clear cached screenshots

        // Restore title if requested
        if (keepTitle && this.planTitle) {
            await this.client.setPlanTitle(this.planTitle);
        }
    }

    /**
     * Process a state transition
     * @param currentState The current state name
     * @param action The action being taken (leave empty for end states)
     * @param nodeType The type of node (action, decision, or end)
     * @param screenshot Optional base64-encoded screenshot to associate with this state
     * @returns Promise resolving when transition is added
     */
    async processTransition(
        currentState: string,
        action: string = "",
        nodeType: "action" | "decision" | "end" = "action",
        screenshot?: string,
    ): Promise<void> {
        // If we have a cached screenshot for this state, use it
        if (!screenshot && this.screenShots.has(currentState)) {
            screenshot = this.screenShots.get(currentState);
        }

        await this.client.addTransition({
            currentState,
            action,
            nodeType,
            screenshot,
        });

        this.currentStateName = currentState;

        // Cache the screenshot for this state if provided
        if (screenshot) {
            this.screenShots.set(currentState, screenshot);
        }
    }

    /**
     * Add a screenshot to an existing node
     * @param stateName The name of the state to add a screenshot to
     * @param screenshot Base64-encoded screenshot data
     * @returns Promise resolving when screenshot is added
     */
    async addScreenshot(stateName: string, screenshot: string): Promise<void> {
        // Find the node ID for this state name
        const nodeId = this.client.findNodeIdByLabel(stateName);

        if (!nodeId) {
            throw new Error(`No node found with label: ${stateName}`);
        }

        await this.client.uploadScreenshot(nodeId, screenshot);

        // Cache the screenshot for this state
        this.screenShots.set(stateName, screenshot);
    }

    /**
     * Mark the current state as an end state
     * @param stateName The name of the end state
     * @param screenshot Optional base64-encoded screenshot to associate with this state
     * @returns Promise resolving when end state is added
     */
    async markEndState(stateName: string, screenshot?: string): Promise<void> {
        // If we have a cached screenshot for this state, use it
        if (!screenshot && this.screenShots.has(stateName)) {
            screenshot = this.screenShots.get(stateName);
        }

        await this.client.addTransition({
            currentState: stateName,
            action: "",
            nodeType: "end",
            screenshot,
        });

        this.currentStateName = stateName;

        // Cache the screenshot for this state if provided
        if (screenshot) {
            this.screenShots.set(stateName, screenshot);
        }
    }

    /**
     * Create a decision point with multiple possible actions
     * @param stateName The name of the decision state
     * @param actions The possible actions from this state
     * @param screenshot Optional base64-encoded screenshot to associate with this state
     * @returns Promise resolving when decision and actions are added
     */
    async createDecisionPoint(
        stateName: string,
        actions: string[],
        screenshot?: string,
    ): Promise<void> {
        // If we have a cached screenshot for this state, use it
        if (!screenshot && this.screenShots.has(stateName)) {
            screenshot = this.screenShots.get(stateName);
        }

        // First add the decision state
        await this.client.addTransition({
            currentState: stateName,
            action: actions[0] || "",
            nodeType: "decision",
            screenshot,
        });

        // Then add subsequent actions if any
        for (let i = 1; i < actions.length; i++) {
            await this.client.addTransition({
                currentState: stateName,
                action: actions[i],
            });
        }

        this.currentStateName = stateName;

        // Cache the screenshot for this state if provided
        if (screenshot) {
            this.screenShots.set(stateName, screenshot);
        }
    }
}

/**
 * Create a hook for tracking code execution states in a loop
 * @param baseUrl The base URL of the visualizer server
 * @param title Optional title for the plan
 * @returns An object with functions for tracking execution
 */
export function createExecutionTracker(
    baseUrl: string,
    title?: string,
): {
    trackState: (
        stateName: string,
        nextAction?: string,
        nodeType?: "action" | "decision" | "end",
        screenshot?: string,
    ) => Promise<void>;
    addScreenshot: (stateName: string, screenshot: string) => Promise<void>;
    reset: (keepTitle?: boolean) => Promise<void>;
    setTitle: (title: string) => Promise<void>;
} {
    const client = new VisualizerClient(baseUrl);
    let planTitle = title || "Execution Plan";
    const screenShots = new Map<string, string>(); // Map state names to screenshots

    // Set initial title if provided
    if (title) {
        client
            .setPlanTitle(title)
            .catch((e) => console.error("Failed to set initial title:", e));
    }

    return {
        /**
         * Track a state in the execution
         * @param stateName The current state name
         * @param nextAction The next action to take (optional)
         * @param nodeType The type of node
         * @param screenshot Optional base64-encoded screenshot for this state
         */
        trackState: async (
            stateName: string,
            nextAction?: string,
            nodeType: "action" | "decision" | "end" = "action",
            screenshot?: string,
        ): Promise<void> => {
            // If we have a cached screenshot for this state, use it
            if (!screenshot && screenShots.has(stateName)) {
                screenshot = screenShots.get(stateName);
            }

            await client.addTransition({
                currentState: stateName,
                action: nextAction || "",
                nodeType,
                screenshot,
            });

            // Cache the screenshot for this state if provided
            if (screenshot) {
                screenShots.set(stateName, screenshot);
            }
        },

        /**
         * Add a screenshot to an existing node
         * @param stateName The name of the state to add a screenshot to
         * @param screenshot Base64-encoded screenshot data
         */
        addScreenshot: async (
            stateName: string,
            screenshot: string,
        ): Promise<void> => {
            // Find the node ID for this state name
            const nodeId = client.findNodeIdByLabel(stateName);

            if (!nodeId) {
                throw new Error(`No node found with label: ${stateName}`);
            }

            await client.uploadScreenshot(nodeId, screenshot);

            // Cache the screenshot for this state
            screenShots.set(stateName, screenshot);
        },

        /**
         * Reset the execution tracker
         * @param keepTitle Whether to keep the current title (default: true)
         */
        reset: async (keepTitle: boolean = true): Promise<void> => {
            await client.resetPlan();
            screenShots.clear(); // Clear cached screenshots

            // Restore title if requested
            if (keepTitle && planTitle) {
                await client.setPlanTitle(planTitle);
            }
        },

        /**
         * Set the title of the execution plan
         * @param newTitle The new title to set
         */
        setTitle: async (newTitle: string): Promise<void> => {
            planTitle = newTitle;
            await client.setPlanTitle(newTitle);
        },
    };
}
