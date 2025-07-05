// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionsStore } from "./actionsStore.mjs";
import { StoredAction, ActionCategory } from "./types.mjs";

/**
 * Compatibility adapter for existing storage API calls
 * 
 * This adapter allows existing code to continue working while using the new ActionsStore
 * behind the scenes. It converts between the old multi-property storage format and the
 * new unified StoredAction format.
 */
export class StorageCompatibilityAdapter {
    private actionsStore: ActionsStore;

    constructor(actionsStore: ActionsStore) {
        this.actionsStore = actionsStore;
    }

    /**
     * Adapter for getStoredPageProperty - converts new storage to old format
     */
    async getStoredPageProperty(url: string, key: string): Promise<any | null> {
        try {
            const actions = await this.actionsStore.getActionsForUrl(url);

            switch (key) {
                case "detectedActions":
                    return this.convertToDetectedActions(actions);

                case "detectedActionDefinitions":
                    return this.convertToDetectedActionDefinitions(actions);

                case "userActions":
                    return this.convertToUserActions(actions);

                case "authoredActionDefinitions":
                    return this.convertToAuthoredActionDefinitions(actions);

                case "authoredActionsJson":
                    return this.convertToAuthoredActionsJson(actions);

                case "authoredIntentJson":
                    return this.convertToAuthoredIntentJson(actions);

                default:
                    console.warn(`Unknown storage property requested: ${key}`);
                    return null;
            }
        } catch (error) {
            console.error(`Failed to get stored page property ${key} for ${url}:`, error);
            return null;
        }
    }

    /**
     * Adapter for setStoredPageProperty - converts old format to new storage
     */
    async setStoredPageProperty(url: string, key: string, value: any): Promise<void> {
        try {
            // For Phase 1, we'll handle the properties individually
            // Phase 2+ will consolidate these into proper action updates
            
            switch (key) {
                case "detectedActions":
                    await this.handleDetectedActions(url, value);
                    break;

                case "detectedActionDefinitions":
                    await this.handleDetectedActionDefinitions(url, value);
                    break;

                case "userActions":
                    await this.handleUserActions(url, value);
                    break;

                case "authoredActionDefinitions":
                    await this.handleAuthoredActionDefinitions(url, value);
                    break;

                case "authoredActionsJson":
                    await this.handleAuthoredActionsJson(url, value);
                    break;

                case "authoredIntentJson":
                    await this.handleAuthoredIntentJson(url, value);
                    break;

                default:
                    console.warn(`Unknown storage property set: ${key}`);
            }
        } catch (error) {
            console.error(`Failed to set stored page property ${key} for ${url}:`, error);
            throw error;
        }
    }

    /**
     * Convert actions to old detectedActions format
     */
    private convertToDetectedActions(actions: StoredAction[]): any[] {
        return actions
            .filter(action => action.author === "discovered")
            .map(action => action.definition.detectedSchema)
            .filter(schema => schema !== undefined);
    }

    /**
     * Convert actions to old detectedActionDefinitions format
     */
    private convertToDetectedActionDefinitions(actions: StoredAction[]): Record<string, any> {
        const definitions: Record<string, any> = {};
        
        actions
            .filter(action => action.author === "discovered" && action.definition.intentSchema)
            .forEach(action => {
                definitions[action.name] = action.definition.intentSchema;
            });

        return definitions;
    }

    /**
     * Convert actions to old userActions format
     */
    private convertToUserActions(actions: StoredAction[]): Record<string, any> {
        const userActions: Record<string, any> = {};

        actions
            .filter(action => action.author === "user")
            .forEach(action => {
                userActions[action.name] = {
                    name: action.name,
                    description: action.description,
                    steps: action.context.recordedSteps || [],
                    screenshot: action.context.screenshots || [],
                    html: action.context.htmlFragments || [],
                    intentSchema: action.definition.intentSchema,
                    actionsJson: action.definition.actionSteps
                };
            });

        return userActions;
    }

    /**
     * Convert actions to old authoredActionDefinitions format
     */
    private convertToAuthoredActionDefinitions(actions: StoredAction[]): Record<string, any> {
        const definitions: Record<string, any> = {};

        actions
            .filter(action => action.author === "user" && action.definition.intentSchema)
            .forEach(action => {
                definitions[action.name] = action.definition.intentSchema;
            });

        return definitions;
    }

    /**
     * Convert actions to old authoredActionsJson format
     */
    private convertToAuthoredActionsJson(actions: StoredAction[]): Record<string, any> {
        const actionsJson: Record<string, any> = {};

        actions
            .filter(action => action.author === "user" && action.definition.actionSteps)
            .forEach(action => {
                actionsJson[action.name] = action.definition.actionSteps;
            });

        return actionsJson;
    }

    /**
     * Convert actions to old authoredIntentJson format
     */
    private convertToAuthoredIntentJson(actions: StoredAction[]): Record<string, any> {
        const intentJson: Record<string, any> = {};

        actions
            .filter(action => action.author === "user" && action.definition.intentJson)
            .forEach(action => {
                intentJson[action.name] = action.definition.intentJson;
            });

        return intentJson;
    }

    /**
     * Handle detected actions being set
     */
    private async handleDetectedActions(url: string, value: any[]): Promise<void> {
        if (!Array.isArray(value)) return;

        const domain = new URL(url).hostname;

        // Create/update detected actions
        for (const detectedAction of value) {
            if (!detectedAction.actionName) continue;

            const actionId = this.generateActionId();
            const action: StoredAction = this.actionsStore.createDefaultAction({
                id: actionId,
                name: detectedAction.actionName,
                description: `Auto-discovered action: ${detectedAction.actionName}`,
                category: "utility",
                author: "discovered",
                scope: {
                    type: "domain",
                    domain: domain,
                    priority: 60
                },
                definition: {
                    detectedSchema: detectedAction
                }
            });

            await this.actionsStore.saveAction(action);
        }
    }

    /**
     * Handle detected action definitions being set
     */
    private async handleDetectedActionDefinitions(url: string, value: Record<string, any>): Promise<void> {
        if (!value || typeof value !== 'object') return;

        const domain = new URL(url).hostname;
        const existingActions = await this.actionsStore.getActionsForDomain(domain);

        // Update existing detected actions with type definitions
        for (const [actionName, definition] of Object.entries(value)) {
            const existingAction = existingActions.find(
                action => action.name === actionName && action.author === "discovered"
            );

            if (existingAction) {
                await this.actionsStore.updateAction(existingAction.id, {
                    definition: {
                        ...existingAction.definition,
                        intentSchema: definition
                    }
                });
            } else {
                // Create new detected action with definition
                const actionId = this.generateActionId();
                const action: StoredAction = this.actionsStore.createDefaultAction({
                    id: actionId,
                    name: actionName,
                    description: `Auto-discovered action: ${actionName}`,
                    category: "utility",
                    author: "discovered",
                    scope: {
                        type: "domain",
                        domain: domain,
                        priority: 60
                    },
                    definition: {
                        intentSchema: definition
                    }
                });

                await this.actionsStore.saveAction(action);
            }
        }
    }

    /**
     * Handle user actions being set
     */
    private async handleUserActions(url: string, value: Record<string, any>): Promise<void> {
        if (!value || typeof value !== 'object') return;

        const domain = new URL(url).hostname;

        for (const [actionName, userActionData] of Object.entries(value)) {
            const actionId = this.generateActionId();
            const action: StoredAction = this.actionsStore.createDefaultAction({
                id: actionId,
                name: actionName,
                description: userActionData.description || `User action: ${actionName}`,
                category: this.inferCategoryFromAction(userActionData),
                author: "user",
                scope: {
                    type: "page",
                    domain: domain,
                    priority: 80
                },
                urlPatterns: [{
                    pattern: url,
                    type: "exact",
                    priority: 100,
                    description: `Exact match for ${url}`
                }],
                definition: {
                    intentSchema: userActionData.intentSchema,
                    actionSteps: userActionData.actionsJson
                },
                context: {
                    recordedSteps: userActionData.steps,
                    screenshots: userActionData.screenshot,
                    htmlFragments: userActionData.html
                }
            });

            await this.actionsStore.saveAction(action);
        }
    }

    /**
     * Handle authored action definitions being set
     */
    private async handleAuthoredActionDefinitions(url: string, value: Record<string, any>): Promise<void> {
        if (!value || typeof value !== 'object') return;

        const domain = new URL(url).hostname;
        const existingActions = await this.actionsStore.getActionsForDomain(domain);

        for (const [actionName, definition] of Object.entries(value)) {
            const existingAction = existingActions.find(
                action => action.name === actionName && action.author === "user"
            );

            if (existingAction) {
                await this.actionsStore.updateAction(existingAction.id, {
                    definition: {
                        ...existingAction.definition,
                        intentSchema: definition
                    }
                });
            }
        }
    }

    /**
     * Handle authored actions JSON being set
     */
    private async handleAuthoredActionsJson(url: string, value: Record<string, any>): Promise<void> {
        if (!value || typeof value !== 'object') return;

        const domain = new URL(url).hostname;
        const existingActions = await this.actionsStore.getActionsForDomain(domain);

        for (const [actionName, actionSteps] of Object.entries(value)) {
            const existingAction = existingActions.find(
                action => action.name === actionName && action.author === "user"
            );

            if (existingAction) {
                await this.actionsStore.updateAction(existingAction.id, {
                    definition: {
                        ...existingAction.definition,
                        actionSteps: actionSteps
                    }
                });
            }
        }
    }

    /**
     * Handle authored intent JSON being set
     */
    private async handleAuthoredIntentJson(url: string, value: Record<string, any>): Promise<void> {
        if (!value || typeof value !== 'object') return;

        const domain = new URL(url).hostname;
        const existingActions = await this.actionsStore.getActionsForDomain(domain);

        for (const [actionName, intentJson] of Object.entries(value)) {
            const existingAction = existingActions.find(
                action => action.name === actionName && action.author === "user"
            );

            if (existingAction) {
                await this.actionsStore.updateAction(existingAction.id, {
                    definition: {
                        ...existingAction.definition,
                        intentJson: intentJson
                    }
                });
            }
        }
    }

    /**
     * Infer action category from user action data
     */
    private inferCategoryFromAction(userActionData: any): ActionCategory {
        const name = userActionData.name?.toLowerCase() || '';
        const description = userActionData.description?.toLowerCase() || '';
        const steps = userActionData.steps || [];

        // Check for form-related actions
        if (name.includes('form') || name.includes('submit') || name.includes('input') ||
            description.includes('form') || description.includes('submit') ||
            steps.some((step: any) => step.type === 'type' || step.type === 'submit')) {
            return 'form';
        }

        // Check for navigation actions
        if (name.includes('navigate') || name.includes('link') || name.includes('click') ||
            description.includes('navigate') || description.includes('link') ||
            steps.some((step: any) => step.type === 'click' && step.target?.includes('a'))) {
            return 'navigation';
        }

        // Check for commerce actions
        if (name.includes('buy') || name.includes('cart') || name.includes('checkout') ||
            name.includes('purchase') || description.includes('buy') ||
            description.includes('cart') || description.includes('checkout')) {
            return 'commerce';
        }

        // Check for search actions
        if (name.includes('search') || name.includes('find') || name.includes('filter') ||
            description.includes('search') || description.includes('find')) {
            return 'search';
        }

        // Default to utility
        return 'utility';
    }

    /**
     * Generate action ID
     */
    private generateActionId(): string {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
