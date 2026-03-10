// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    AppAgent,
    AppAgentManifest,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { WebAgent, WebAgentContext } from "../WebAgentContext";
import {
    ContinuationState,
    CrosswordSchema,
    crosswordSchemaStorage,
} from "../../contentScript/webAgentStorage";
import { extractCrosswordSchema } from "../webAgentRpc";

declare global {
    interface Window {
        registerTypeAgent?: (
            name: string,
            manifest: AppAgentManifest,
            agent: AppAgent,
        ) => Promise<void>;
    }
}

const CROSSWORD_URL_PATTERNS = [
    /wsj\.com\/puzzles\/crossword/,
    /embed\.universaluclick\.com\//,
    /data\.puzzlexperts\.com\/puzzleapp/,
    /nytsyn\.pzzl\.com\/cwd_seattle/,
    /seattletimes\.com\/games-nytimes-crossword/,
    /denverpost\.com\/games\/daily-crossword/,
    /denverpost\.com\/puzzles\/\?amu=\/iwin-crossword/,
    /bestcrosswords\.com\/bestcrosswords\/guestconstructor/,
];

// Schema definition for TypeAgent registration
const CROSSWORD_SCHEMA_TS = `
export type CrosswordActions = EnterText | GetClueValue;

export type EnterText = {
    actionName: "enterText";
    parameters: {
        value: string;
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};

export type GetClueValue = {
    actionName: "getClueValue";
    parameters: {
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};
`;

type CrosswordActions = EnterText | GetClueValue;

type EnterText = {
    actionName: "enterText";
    parameters: {
        value: string;
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};

type GetClueValue = {
    actionName: "getClueValue";
    parameters: {
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};

interface CrosswordObserverState {
    observer: MutationObserver;
    monitoredSelectors: string[];
    monitoredTexts: string[];
    debounceTimer: number | null;
}

export class CrosswordWebAgent implements WebAgent {
    name = "crossword";
    urlPatterns = CROSSWORD_URL_PATTERNS;

    private schema: CrosswordSchema | null = null;
    private observerState: CrosswordObserverState | null = null;
    private context: WebAgentContext | null = null;
    private registered = false;

    async initialize(context: WebAgentContext): Promise<void> {
        console.log("[CrosswordWebAgent] initialize() called");
        this.context = context;
        const url = context.getCurrentUrl();
        console.log(`[CrosswordWebAgent] URL: ${url}`);
        const notificationId = `crossword-${Date.now()}`;

        console.log("[CrosswordWebAgent] Sending loading notification...");
        await context.notify(
            "Loading the crossword agent to get it ready for interaction...",
            notificationId,
        );

        console.log("[CrosswordWebAgent] Checking for cached schema...");
        this.schema = crosswordSchemaStorage.get(url);

        if (!this.schema) {
            console.log(
                "[CrosswordWebAgent] Schema not cached, waiting for page to fully load...",
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
            console.log("[CrosswordWebAgent] Fetching schema from server...");
            try {
                const startTime = performance.now();
                this.schema = await extractCrosswordSchema();
                const elapsed = (performance.now() - startTime).toFixed(0);
                console.log(
                    `[CrosswordWebAgent] Schema fetched in ${elapsed}ms`,
                );
                crosswordSchemaStorage.set(url, this.schema);
                console.log(
                    "[CrosswordWebAgent] Schema cached to localStorage",
                );
            } catch (error) {
                console.error(
                    "[CrosswordWebAgent] Failed to extract schema:",
                    error,
                );
                await context.notify(
                    "There was an error when initializing the crossword. Try re-loading the page.",
                    notificationId,
                );
                return;
            }
        } else {
            console.log(
                "[CrosswordWebAgent] Using cached schema from localStorage",
            );
        }

        if (this.schema) {
            const acrossCount = Object.keys(this.schema.clues.across).length;
            const downCount = Object.keys(this.schema.clues.down).length;
            console.log(
                `[CrosswordWebAgent] Schema loaded: ${acrossCount} across, ${downCount} down clues`,
            );

            // Register with TypeAgent
            await this.registerWithTypeAgent();

            console.log("[CrosswordWebAgent] Sending success notification...");
            await context.notify(
                `The crossword is fully loaded and ready for interaction with ${acrossCount} across and ${downCount} down clues. Try asking questions like "What is the clue for 1 across?" or "Enter 'Foo' in the answer for 2 down."`,
                notificationId,
            );

            console.log("[CrosswordWebAgent] Setting up mutation observer...");
            this.setupMutationObserver();
            console.log("[CrosswordWebAgent] Initialization complete");
        }
    }

    private async registerWithTypeAgent(): Promise<void> {
        if (this.registered) {
            console.log(
                "[CrosswordWebAgent] Already registered with TypeAgent",
            );
            return;
        }

        if (!window.registerTypeAgent) {
            console.error(
                "[CrosswordWebAgent] registerTypeAgent not available",
            );
            return;
        }

        // Set flag immediately to prevent race conditions with double registration
        this.registered = true;

        // Load compiled grammar
        let grammarContent: string | undefined;
        try {
            const grammarUrl = this.getGrammarUrl();
            if (grammarUrl) {
                console.log(
                    `[CrosswordWebAgent] Loading grammar from: ${grammarUrl}`,
                );
                const response = await fetch(grammarUrl);
                if (response.ok) {
                    grammarContent = await response.text();
                    console.log(
                        "[CrosswordWebAgent] Grammar loaded successfully",
                    );
                } else {
                    console.warn(
                        `[CrosswordWebAgent] Failed to load grammar: ${response.status}`,
                    );
                }
            }
        } catch (error) {
            console.warn("[CrosswordWebAgent] Error loading grammar:", error);
        }

        const agent = this.createAppAgent();
        const manifest: AppAgentManifest = {
            emojiChar: "🧩",
            description:
                "This allows users to interact with a crossword puzzle. Users can enter text into clue answers and query clue values.",
            schema: {
                description:
                    "This allows users to interact with a crossword puzzle. Users can enter text into clue answers and query clue values.",
                schemaType: "CrosswordActions",
                schemaFile: { content: CROSSWORD_SCHEMA_TS, format: "ts" },
                grammarFile: grammarContent
                    ? { content: grammarContent, format: "ag" }
                    : undefined,
            },
        };

        try {
            console.log("[CrosswordWebAgent] Registering with TypeAgent...");
            await window.registerTypeAgent("crossword", manifest, agent);
            console.log(
                "[CrosswordWebAgent] Successfully registered with TypeAgent",
            );
        } catch (error) {
            // Reset flag on failure so registration can be retried
            this.registered = false;
            console.error(
                "[CrosswordWebAgent] Failed to register with TypeAgent:",
                error,
            );
        }
    }

    private getGrammarUrl(): string | undefined {
        // In Chrome extension context
        if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
            return chrome.runtime.getURL(
                "webagent/crossword/crosswordSchema.ag.json",
            );
        }
        // In Electron context, grammar is loaded relative to the script
        // The grammar file should be in the same relative location
        return undefined; // Electron will need different handling
    }

    private createAppAgent(): AppAgent {
        const webAgent = this;
        return {
            async executeAction(
                action: TypeAgentAction<CrosswordActions>,
            ): Promise<ActionResult | undefined> {
                console.log(
                    `[CrosswordWebAgent] executeAction: ${action.actionName}`,
                );
                try {
                    const actionName = action.actionName;
                    let message = "OK";

                    switch (actionName) {
                        case "enterText": {
                            const params = action.parameters;
                            await webAgent.executeEnterText(
                                params.value,
                                params.clueNumber,
                                params.clueDirection,
                            );
                            message = `OK. Setting the value of ${params.clueNumber} ${params.clueDirection} to "${params.value}"`;
                            break;
                        }
                        case "getClueValue": {
                            const params = action.parameters;
                            const clueText = webAgent.executeGetClueValue(
                                params.clueNumber,
                                params.clueDirection,
                            );
                            message = `The clue is: ${clueText}`;
                            console.log(`[CrosswordWebAgent] ${message}`);
                            break;
                        }
                    }

                    console.log(
                        `[CrosswordWebAgent] executeAction completed successfully`,
                    );
                    return {
                        entities: [],
                        displayContent: message,
                    };
                } catch (error) {
                    console.error(
                        `[CrosswordWebAgent] executeAction error:`,
                        error,
                    );
                    throw error;
                }
            },
        };
    }

    private async executeEnterText(
        value: string,
        clueNumber: number,
        clueDirection: "across" | "down",
    ): Promise<void> {
        if (!this.schema || !this.context) {
            throw new Error("Crossword schema not available");
        }

        const clue = this.schema.clues[clueDirection]?.[clueNumber];
        if (!clue) {
            throw new Error(`Clue ${clueNumber} ${clueDirection} not found`);
        }

        await this.context.ui.clickOn(clue.selector);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const textUpper = String(value).toUpperCase();
        for (const char of textUpper) {
            await this.typeKey(char);
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        console.log(
            `[CrosswordWebAgent] Entered "${value}" for ${clueNumber} ${clueDirection}`,
        );
    }

    private executeGetClueValue(
        clueNumber: number,
        clueDirection: "across" | "down",
    ): string {
        if (!this.schema) {
            throw new Error("Crossword schema not available");
        }

        const clue = this.schema.clues[clueDirection]?.[clueNumber];
        if (!clue) {
            throw new Error(`Clue ${clueNumber} ${clueDirection} not found`);
        }

        return clue.text;
    }

    private setupMutationObserver(): void {
        if (!this.schema) return;

        this.disconnectObserver();

        const allClues = [
            ...Object.values(this.schema.clues.across),
            ...Object.values(this.schema.clues.down),
        ];
        const sampleClues = allClues.slice(0, 5);
        const selectors = sampleClues.map((c) => c.selector).filter(Boolean);
        const texts = sampleClues.map((c) => c.text);

        if (selectors.length === 0) {
            console.log(
                "[CrosswordWebAgent] No selectors available for observer",
            );
            return;
        }

        console.log(
            "[CrosswordWebAgent] Setting up mutation observer for selectors:",
            selectors,
        );

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (this.hasRelevantChange(mutation, selectors, texts)) {
                    this.handleClueChange();
                    break;
                }
            }
        });

        selectors.forEach((selector) => {
            const element = document.querySelector(selector);
            if (element) {
                observer.observe(element, {
                    characterData: true,
                    childList: true,
                    subtree: true,
                });

                if (element.parentElement) {
                    observer.observe(element.parentElement, {
                        childList: true,
                    });
                }
            }
        });

        this.observerState = {
            observer,
            monitoredSelectors: selectors,
            monitoredTexts: texts,
            debounceTimer: null,
        };

        console.log(
            "[CrosswordWebAgent] Mutation observer set up successfully",
        );
    }

    private hasRelevantChange(
        mutation: MutationRecord,
        selectors: string[],
        texts: string[],
    ): boolean {
        if (mutation.type === "characterData") {
            const newText = mutation.target.textContent || "";
            return !texts.some((text) => newText.includes(text));
        }

        if (mutation.type === "childList") {
            for (const node of Array.from(mutation.removedNodes)) {
                if (node instanceof Element) {
                    for (const selector of selectors) {
                        if (
                            node.matches(selector) ||
                            node.querySelector(selector)
                        ) {
                            return true;
                        }
                    }
                }
            }

            for (const node of Array.from(mutation.addedNodes)) {
                if (node instanceof Element) {
                    for (const selector of selectors) {
                        if (
                            node.matches(selector) ||
                            node.querySelector(selector)
                        ) {
                            return true;
                        }
                    }
                }
            }
        }

        return false;
    }

    private handleClueChange(): void {
        if (!this.observerState) return;

        if (this.observerState.debounceTimer) {
            clearTimeout(this.observerState.debounceTimer);
        }

        this.observerState.debounceTimer = window.setTimeout(async () => {
            console.log(
                "[CrosswordWebAgent] Clue change detected, refreshing schema only",
            );

            await this.refreshSchemaOnly();

            this.observerState!.debounceTimer = null;
        }, 500);
    }

    private async refreshSchemaOnly(): Promise<void> {
        if (!this.context) return;

        const url = this.context.getCurrentUrl();
        crosswordSchemaStorage.remove(url);

        try {
            this.schema = await extractCrosswordSchema();
            crosswordSchemaStorage.set(url, this.schema);

            this.setupMutationObserver();

            const acrossCount = Object.keys(this.schema.clues.across).length;
            const downCount = Object.keys(this.schema.clues.down).length;

            console.log(
                `[CrosswordWebAgent] Schema refreshed: ${acrossCount} across, ${downCount} down`,
            );
        } catch (error) {
            console.error(
                "[CrosswordWebAgent] Failed to refresh schema:",
                error,
            );
        }
    }

    private disconnectObserver(): void {
        if (this.observerState?.observer) {
            console.log("[CrosswordWebAgent] Disconnecting mutation observer");
            this.observerState.observer.disconnect();

            if (this.observerState.debounceTimer) {
                clearTimeout(this.observerState.debounceTimer);
            }

            this.observerState = null;
        }
    }

    private async typeKey(char: string): Promise<void> {
        const keydownEvent = new KeyboardEvent("keydown", {
            key: char,
            code: `Key${char.toUpperCase()}`,
            charCode: char.charCodeAt(0),
            keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0),
            bubbles: true,
            cancelable: true,
        });
        document.activeElement?.dispatchEvent(keydownEvent);

        const keypressEvent = new KeyboardEvent("keypress", {
            key: char,
            code: `Key${char.toUpperCase()}`,
            charCode: char.charCodeAt(0),
            keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0),
            bubbles: true,
            cancelable: true,
        });
        document.activeElement?.dispatchEvent(keypressEvent);

        const keyupEvent = new KeyboardEvent("keyup", {
            key: char,
            code: `Key${char.toUpperCase()}`,
            charCode: char.charCodeAt(0),
            keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0),
            bubbles: true,
            cancelable: true,
        });
        document.activeElement?.dispatchEvent(keyupEvent);
    }

    handleContinuation(
        continuation: ContinuationState,
        context: WebAgentContext,
    ): Promise<void> {
        console.log(
            "[CrosswordWebAgent] Continuation not implemented:",
            continuation,
        );
        return Promise.resolve();
    }
}
