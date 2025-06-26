// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { FeatureConfig, ServerConfig, SSEManager } from "./types.js";
import { SSEManagerImpl } from "./sseManager.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:views:server:core");

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Base server class that provides core functionality for the views server
 */
export class BaseServer {
    private app: Express;
    private sseManager: SSEManager;
    private features: Map<string, FeatureConfig> = new Map();
    private config: ServerConfig;

    constructor(config: ServerConfig) {
        this.config = config;
        this.app = express();
        this.sseManager = new SSEManagerImpl();
        this.setupMiddleware();
        this.setupCoreRoutes();
    }

    /**
     * Setup core middleware
     */
    private setupMiddleware(): void {
        // Rate limiting
        const limiter = rateLimit({
            windowMs: this.config.rateLimitWindow || 60000,
            max: this.config.rateLimitMax || 100,
        });
        this.app.use(limiter);

        // Body parsing
        this.app.use(express.json({ limit: this.config.bodyLimit || "10mb" }));
        this.app.use(
            express.urlencoded({
                limit: this.config.bodyLimit || "10mb",
                extended: true,
            }),
        );

        // CORS if enabled
        if (this.config.enableCors) {
            this.app.use((req, res, next) => {
                res.header("Access-Control-Allow-Origin", "*");
                res.header(
                    "Access-Control-Allow-Methods",
                    "GET, POST, PUT, DELETE, OPTIONS",
                );
                res.header(
                    "Access-Control-Allow-Headers",
                    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
                );
                if (req.method === "OPTIONS") {
                    res.sendStatus(200);
                } else {
                    next();
                }
            });
        }

        // Static file serving
        this.app.use(
            express.static(path.join(__dirname, "..", "..", "public")),
        );

        debug("Core middleware setup complete");
    }

    /**
     * Setup core routes that are not feature-specific
     */
    private setupCoreRoutes(): void {
        this.app.get("/api/health", (req: Request, res: Response) => {
            res.json({
                status: "healthy",
                timestamp: new Date().toISOString(),
                features: Array.from(this.features.keys()),
                clients: this.sseManager.getNamespaces().reduce(
                    (acc: Record<string, number>, ns: string) => {
                        acc[ns] = this.sseManager.getClientCount(ns);
                        return acc;
                    },
                    {} as Record<string, number>,
                ),
            });
        });

        debug("Core routes setup complete");
    }

    /**
     * Register a feature with the server
     */
    registerFeature(featureConfig: FeatureConfig): void {
        debug(
            `Registering feature: ${featureConfig.name} at ${featureConfig.basePath}`,
        );

        this.features.set(featureConfig.name, featureConfig);

        // Setup feature routes
        featureConfig.setupRoutes(this.app);

        // Setup feature SSE if needed
        if (featureConfig.setupSSE) {
            featureConfig.setupSSE(this.sseManager);
        }

        debug(`Feature '${featureConfig.name}' registered successfully`);
    }

    /**
     * Get the SSE manager instance
     */
    getSSEManager(): SSEManager {
        return this.sseManager;
    }

    /**
     * Get the Express app instance
     */
    getApp(): Express {
        return this.app;
    }

    /**
     * Start the server
     */
    start(): Promise<void> {
        return new Promise((resolve) => {
            this.app.listen(this.config.port, () => {
                debug(`Server running at http://localhost:${this.config.port}`);
                debug(
                    `Registered features: ${Array.from(this.features.keys()).join(", ")}`,
                );
                resolve();
            });
        });
    }
}
