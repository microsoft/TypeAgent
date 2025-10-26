// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MacroStore } from "../../storage/index.mjs";
import { YAMLMacroManager } from "./index.mjs";
import { YAMLMacro } from "./types.mjs";

export class YAMLMacroStoreExtension {
    private yamlManager: YAMLMacroManager;

    constructor(
        private macroStore: MacroStore,
        macrosBasePath: string,
        sessionStorage?: any,
    ) {
        this.yamlManager = new YAMLMacroManager(macrosBasePath, sessionStorage);
    }

    async saveYAMLMacro(
        yamlMacro: YAMLMacro,
        macroId: string,
    ): Promise<{ success: boolean; macroId?: string; error?: string }> {
        try {
            const jsonMacro = await this.yamlManager.convertYAMLToJSON(
                yamlMacro,
                macroId,
            );

            const result = await this.macroStore.saveMacro(jsonMacro);

            return result;
        } catch (error) {
            return {
                success: false,
                error: `Failed to save YAML macro: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async loadYAMLMacro(macroId: string): Promise<YAMLMacro | null> {
        try {
            const jsonMacro = await this.macroStore.getMacro(macroId);

            if (!jsonMacro) {
                return null;
            }

            const result = await this.yamlManager.convertJSONToYAML(jsonMacro);

            return result.yaml;
        } catch (error) {
            console.error(`Failed to load YAML macro ${macroId}:`, error);
            return null;
        }
    }

    async createYAMLFromRecording(params: {
        name: string;
        description: string;
        author: string;
        category?: string;
        domain: string;
        url: string;
        parameters: Record<string, any>;
        steps: any[];
        screenshots?: string[];
        recordedSteps?: any[];
    }): Promise<{ yamlMacro: YAMLMacro; recordingId: string }> {
        const recordingId = this.generateMacroId();

        // Try to save artifacts separately, but don't fail if we can't
        // (e.g., when using sessionStorage abstraction)
        if (params.screenshots || params.recordedSteps) {
            try {
                await this.yamlManager.saveArtifacts(recordingId, {
                    screenshots: params.screenshots || [],
                    recording: params.recordedSteps || [],
                    url: params.url,
                });
            } catch (error) {
                // If artifacts can't be saved separately, they'll be included in JSON
                console.warn(
                    "Could not save artifacts separately, will include in macro definition:",
                    error,
                );
            }
        }

        const yamlMacro: YAMLMacro = {
            macro: {
                name: params.name,
                version: "1.0.0",
                description: params.description,
                author: params.author,
                category: params.category || "utility",
                tags: [],
                scope: {
                    type: "page",
                    domain: params.domain,
                    priority: 80,
                },
                urlPatterns: [
                    {
                        pattern: params.url,
                        type: "exact",
                        priority: 100,
                    },
                ],
                parameters: params.parameters,
                steps: params.steps,
            },
            metadata: {
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                usageCount: 0,
                isValid: true,
                ...(params.screenshots || params.recordedSteps
                    ? { artifacts: { recordingId } }
                    : {}),
            },
        };

        return { yamlMacro, recordingId };
    }

    async createYAMLFromLLMAuthoring(params: {
        name: string;
        description: string;
        domain: string;
        parameters: Record<string, any>;
        steps: any[];
    }): Promise<YAMLMacro> {
        const yamlMacro: YAMLMacro = {
            macro: {
                name: params.name,
                version: "1.0.0",
                description: params.description,
                author: "user",
                category: "automation",
                tags: [],
                scope: {
                    type: "page",
                    domain: params.domain,
                    priority: 70,
                },
                parameters: params.parameters,
                steps: params.steps,
            },
            metadata: {
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                usageCount: 0,
                isValid: true,
            },
        };

        return yamlMacro;
    }

    getYAMLString(yamlMacro: YAMLMacro): string {
        return this.yamlManager.stringifyYAML(yamlMacro);
    }

    parseYAMLString(yamlContent: string): YAMLMacro {
        return this.yamlManager.parseYAML(yamlContent);
    }

    private generateMacroId(): string {
        return (
            Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15)
        );
    }
}
