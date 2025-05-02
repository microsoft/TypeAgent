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
    nodeType?: "action" | "decision" | "end";
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
    constructor(private baseUrl: string = "http://localhost:3000") {}

    /**
     * Helper method to handle fetch requests
     * @param endpoint API endpoint
     * @param options Fetch options
     * @returns Promise resolving to the parsed response
     */
    private async fetchApi<T>(
        endpoint: string,
        options?: RequestInit,
    ): Promise<T> {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, options);

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return (await response.json()) as T;
        } catch (error) {
            console.error(`Error fetching ${endpoint}:`, error);
            throw error;
        }
    }

    /**
     * Get the current plan data
     * @param mode The view mode (static or dynamic)
     * @returns Promise resolving to the plan data
     */
    async getPlan(
        mode: "static" | "dynamic" = "dynamic",
    ): Promise<WebPlanData> {
        const data = await this.fetchApi<WebPlanData>(`/api/plan?mode=${mode}`);
        this.currentPlan = data;
        return data;
    }

    /**
     * Add a transition to the plan
     * @param data The transition data
     * @returns Promise resolving to the updated plan data
     */
    async addTransition(data: TransitionData): Promise<WebPlanData> {
        const updatedPlan = await this.fetchApi<WebPlanData>(
            "/api/transition",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(data),
            },
        );

        this.currentPlan = updatedPlan;
        return updatedPlan;
    }

    /**
     * Reset the plan to its initial state
     * @returns Promise resolving to the reset plan data
     */
    async resetPlan(): Promise<WebPlanData> {
        const resetPlan = await this.fetchApi<WebPlanData>("/api/reset", {
            method: "POST",
        });

        this.currentPlan = resetPlan;
        return resetPlan;
    }

    /**
     * Set the title of the current plan
     * @param title The title to set
     * @returns Promise resolving to the updated plan data
     */
    async setPlanTitle(title: string): Promise<WebPlanData> {
        const updatedPlan = await this.fetchApi<WebPlanData>("/api/title", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ title }),
        });

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

    /**
     * Create a new state machine tracker
     * @param baseUrl The base URL of the visualizer server
     * @param title Optional title for the plan
     */
    constructor(baseUrl: string = "http://localhost:3000", title?: string) {
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
     * @returns Promise resolving when transition is added
     */
    async processTransition(
        currentState: string,
        action: string = "",
        nodeType: "action" | "decision" | "end" = "action",
    ): Promise<void> {
        await this.client.addTransition({
            currentState,
            action,
            nodeType,
        });

        this.currentStateName = currentState;
    }

    /**
     * Mark the current state as an end state
     * @param stateName The name of the end state
     * @returns Promise resolving when end state is added
     */
    async markEndState(stateName: string): Promise<void> {
        await this.client.addTransition({
            currentState: stateName,
            action: "",
            nodeType: "end",
        });

        this.currentStateName = stateName;
    }

    /**
     * Create a decision point with multiple possible actions
     * @param stateName The name of the decision state
     * @param actions The possible actions from this state
     * @returns Promise resolving when decision and actions are added
     */
    async createDecisionPoint(
        stateName: string,
        actions: string[],
    ): Promise<void> {
        // First add the decision state
        await this.client.addTransition({
            currentState: stateName,
            action: actions[0] || "",
            nodeType: "decision",
        });

        // Then add subsequent actions if any
        for (let i = 1; i < actions.length; i++) {
            await this.client.addTransition({
                currentState: stateName,
                action: actions[i],
            });
        }

        this.currentStateName = stateName;
    }
}

/**
 * Create a hook for tracking code execution states in a loop
 * @param baseUrl The base URL of the visualizer server
 * @param title Optional title for the plan
 * @returns An object with functions for tracking execution
 */
export function createExecutionTracker(
    baseUrl: string = "http://localhost:3000",
    title?: string,
): {
    trackState: (
        stateName: string,
        nextAction?: string,
        nodeType?: "action" | "decision" | "end",
    ) => Promise<void>;
    reset: (keepTitle?: boolean) => Promise<void>;
    setTitle: (title: string) => Promise<void>;
} {
    const client = new VisualizerClient(baseUrl);
    let planTitle = title || "Execution Plan";

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
         */
        trackState: async (
            stateName: string,
            nextAction?: string,
            nodeType: "action" | "decision" | "end" = "action",
        ): Promise<void> => {
            await client.addTransition({
                currentState: stateName,
                action: nextAction || "",
                nodeType,
            });
        },

        /**
         * Reset the execution tracker
         * @param keepTitle Whether to keep the current title (default: true)
         */
        reset: async (keepTitle: boolean = true): Promise<void> => {
            await client.resetPlan();

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
