// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Express, Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SSEManager, FeatureConfig } from "../../core/types.js";
import { SSEManagerImpl } from "../../core/sseManager.js";
import { PlansService } from "./plansService.js";
import {
    TransitionRequest,
    TitleRequest,
    ScreenshotRequest,
    PlansSSEEvent,
} from "./plansTypes.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:views:server:plans:routes");

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Plans feature routes configuration
 */
export class PlansRoutes {
    private plansService: PlansService;
    private sseManager?: SSEManager;

    constructor() {
        this.plansService = new PlansService();
    }

    /**
     * Create the feature configuration for plans
     */
    static createFeatureConfig(): FeatureConfig {
        const plansRoutes = new PlansRoutes();

        return {
            name: "plans",
            basePath: "/plans",
            setupRoutes: (app: Express) => plansRoutes.setupRoutes(app),
            setupSSE: (sseManager: SSEManager) =>
                plansRoutes.setupSSE(sseManager),
        };
    }

    /**
     * Setup SSE for plans
     */
    setupSSE(sseManager: SSEManager): void {
        this.sseManager = sseManager;
        debug("Plans SSE setup complete");
    }

    /**
     * Broadcast update to connected clients
     */
    private broadcastUpdate(updateType: string, data: any): void {
        if (!this.sseManager) {
            debug("No SSE manager available for broadcast");
            return;
        }

        const eventData: PlansSSEEvent = {
            type: updateType,
            data: data,
            timestamp: new Date().toISOString(),
        };

        this.sseManager.broadcast("plans", eventData);
    }

    /**
     * Setup all plans routes
     */
    setupRoutes(app: Express): void {
        // Serve the plans visualization page
        app.get("/", this.serveIndex.bind(this));
        app.get("/plans", this.serveIndex.bind(this));
        app.get("/plans/", this.serveIndex.bind(this));

        // SSE endpoint for real-time updates
        app.get("/api/plans/events", this.handleSSEConnection.bind(this));

        // API endpoints
        app.get("/api/plans/plan", this.getPlan.bind(this));
        app.post("/api/plans/transition", this.addTransition.bind(this));
        app.post("/api/plans/title", this.updateTitle.bind(this));
        app.post("/api/plans/screenshot", this.updateScreenshot.bind(this));
        app.post("/api/plans/reset", this.resetPlan.bind(this));

        debug("Plans routes setup complete");
    }

    /**
     * Serve the main plans page
     */
    private serveIndex(req: Request, res: Response): void {
        res.sendFile(
            path.join(
                __dirname,
                "..",
                "..",
                "..",
                "..",
                "public",
                "plans",
                "index.html",
            ),
        );
    }

    /**
     * Handle SSE connection for plans
     */
    private handleSSEConnection(req: Request, res: Response): void {
        if (!this.sseManager) {
            res.status(500).json({ error: "SSE not configured" });
            return;
        }

        SSEManagerImpl.setupSSEHeaders(res);
        this.sseManager.addClient("plans", res);

        debug("New plans SSE client connected");
    }
    /**
     * Get plan data
     */
    private getPlan(req: Request, res: Response): void {
        try {
            const viewMode = (req.query.mode as string) || "dynamic";
            const planData = this.plansService.getPlan(viewMode);
            res.json(planData);
        } catch (error) {
            debug("Error getting plan:", error);
            res.status(500).json({ error: "Failed to get plan data" });
        }
    }

    /**
     * Add a new state transition
     */
    private addTransition(req: Request, res: Response): void {
        try {
            const transitionData = req.body as TransitionRequest;
            const updatedPlan = this.plansService.addTransition(transitionData);

            // Broadcast update to connected clients
            this.broadcastUpdate("transition", updatedPlan);

            res.json(updatedPlan);
        } catch (error) {
            debug("Error adding transition:", error);
            res.status(400).json({ error: (error as Error).message });
        }
    }

    /**
     * Update plan title
     */
    private updateTitle(req: Request, res: Response): void {
        try {
            const { title } = req.body as TitleRequest;
            const mode = (req.query.mode as string) || "dynamic";

            const updatedPlan = this.plansService.updateTitle(title, mode);

            // Broadcast update to connected clients
            this.broadcastUpdate("title", updatedPlan);

            res.json(updatedPlan);
        } catch (error) {
            debug("Error updating title:", error);
            res.status(400).json({ error: (error as Error).message });
        }
    }

    /**
     * Update node screenshot
     */
    private updateScreenshot(req: Request, res: Response): void {
        try {
            const { nodeId, screenshot } = req.body as ScreenshotRequest;

            const updatedPlan = this.plansService.updateScreenshot(
                nodeId,
                screenshot,
            );

            // Broadcast update to connected clients
            this.broadcastUpdate("node-update", updatedPlan);

            res.json(updatedPlan);
        } catch (error) {
            debug("Error updating screenshot:", error);
            res.status(400).json({ error: (error as Error).message });
        }
    }

    /**
     * Reset plan data
     */
    private resetPlan(req: Request, res: Response): void {
        try {
            const preserveTitle = req.query.preserveTitle === "true";
            const updatedPlan = this.plansService.reset(preserveTitle);

            // Broadcast update to connected clients
            this.broadcastUpdate("reset", updatedPlan);

            res.json(updatedPlan);
        } catch (error) {
            debug("Error resetting plan:", error);
            res.status(500).json({ error: "Failed to reset plan" });
        }
    }
}
