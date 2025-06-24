// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Service for handling API calls to the server
 */
import CONFIG from "./config.js";
import {
    WebPlanData,
    TransitionFormData,
    TransitionResponse,
    TitleUpdateRequest,
} from "../../shared/types.js";

class ApiService {
    /**
     * Fetch plan data from the server
     * @param {string} viewMode - Current view mode (static or dynamic)
     * @returns {Promise<WebPlanData>} Promise that resolves to the plan data
     */
    static async getPlan(viewMode: string): Promise<WebPlanData> {
        try {
            const response = await fetch(
                `${CONFIG.API.GET_PLAN}?mode=${viewMode}`,
            );

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return (await response.json()) as WebPlanData;
        } catch (error) {
            console.error("Error fetching plan data:", error);
            throw error;
        }
    }

    /**
     * Add a new transition to the plan
     * @param {TransitionFormData} formData - Form data containing state and action info
     * @returns {Promise<TransitionResponse>} Promise that resolves to the updated plan data
     */
    static async addTransition(
        formData: TransitionFormData,
    ): Promise<TransitionResponse> {
        try {
            // Store the current plan data before making the request
            const oldPlanData: WebPlanData = JSON.parse(
                JSON.stringify(
                    window.webPlanData || {
                        nodes: [],
                        links: [],
                        currentNode: null,
                        title: "Dynamic Plan",
                    },
                ),
            );

            // Prepare the request body - include screenshot data if available
            const requestBody: TransitionFormData = {
                currentState: formData.currentState,
                action: formData.action,
                nodeType: formData.nodeType,
            };

            if (formData.screenshot) {
                requestBody.screenshot = formData.screenshot;
            }

            const response = await fetch(CONFIG.API.ADD_TRANSITION, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const newPlanData = (await response.json()) as WebPlanData;

            return {
                oldData: oldPlanData,
                newData: newPlanData,
            };
        } catch (error) {
            console.error("Error adding transition:", error);
            throw error;
        }
    }

    /**
     * Reset the plan
     * @param {boolean} preserveTitle - Whether to preserve the current title
     * @returns {Promise<WebPlanData>} Promise that resolves to the reset plan data
     */
    static async resetPlan(
        preserveTitle: boolean = false,
    ): Promise<WebPlanData> {
        try {
            const url = preserveTitle
                ? `${CONFIG.API.RESET_PLAN}?preserveTitle=true`
                : CONFIG.API.RESET_PLAN;

            const response = await fetch(url, {
                method: "POST",
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return (await response.json()) as WebPlanData;
        } catch (error) {
            console.error("Error resetting plan:", error);
            throw error;
        }
    }

    /**
     * Update the plan title
     * @param {string} title - New title for the plan
     * @param {string} viewMode - Current view mode (static or dynamic)
     * @returns {Promise<WebPlanData>} Promise that resolves to the updated plan data
     */
    static async updateTitle(
        title: string,
        viewMode: string = "dynamic",
    ): Promise<WebPlanData> {
        try {
            if (!title.trim()) {
                throw new Error("Title cannot be empty");
            }

            const titleData: TitleUpdateRequest = { title };

            const response = await fetch(
                `${CONFIG.API.SET_TITLE}?mode=${viewMode}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(titleData),
                },
            );

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return (await response.json()) as WebPlanData;
        } catch (error) {
            console.error("Error updating title:", error);
            throw error;
        }
    }

    /**
     * Create a backup of the current plan data
     * @returns {string} JSON string of the current plan data
     */
    static createBackup(): string {
        try {
            const currentData = window.webPlanData || {
                nodes: [],
                links: [],
                currentNode: null,
                title: "Dynamic Plan",
            };

            return JSON.stringify(currentData, null, 2);
        } catch (error) {
            console.error("Error creating backup:", error);
            throw error;
        }
    }

    /**
     * Import plan data from JSON string
     * @param {string} jsonData - JSON string containing plan data
     * @returns {WebPlanData} Parsed plan data
     */
    static parseImportData(jsonData: string): WebPlanData {
        try {
            const parsedData = JSON.parse(jsonData) as WebPlanData;

            // Validate the structure
            if (!parsedData.nodes || !Array.isArray(parsedData.nodes)) {
                throw new Error("Invalid plan data: Missing nodes array");
            }

            if (!parsedData.links || !Array.isArray(parsedData.links)) {
                throw new Error("Invalid plan data: Missing links array");
            }

            if (!parsedData.title) {
                parsedData.title = "Imported Plan";
            }

            return parsedData;
        } catch (error) {
            console.error("Error parsing import data:", error);
            throw error;
        }
    }

    /**
     * Upload a screenshot for a node
     * @param {string} nodeId - ID of the node to add screenshot to
     * @param {string} screenshot - Base64-encoded screenshot data
     * @returns {Promise<WebPlanData>} Promise that resolves to the updated plan data
     */
    static async uploadScreenshot(
        nodeId: string,
        screenshot: string,
    ): Promise<WebPlanData> {
        try {
            if (!nodeId) {
                throw new Error("Node ID is required");
            }

            if (!screenshot) {
                throw new Error("Screenshot data is required");
            }

            const response = await fetch(CONFIG.API.UPLOAD_SCREENSHOT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    nodeId,
                    screenshot,
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return (await response.json()) as WebPlanData;
        } catch (error) {
            console.error("Error uploading screenshot:", error);
            throw error;
        }
    }
}

export default ApiService;
