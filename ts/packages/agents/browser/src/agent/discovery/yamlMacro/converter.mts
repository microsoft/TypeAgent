// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    YAMLMacro,
    MinimalYAMLMacro,
    YAMLParameterDefinition,
    YAMLMacroStep,
} from "./types.mjs";
import {
    generateIntentSchema,
    generateActionSchemaDefinition,
    generateIntentJson,
} from "./schemaGenerator.mjs";
import { ArtifactsStorage } from "./artifactsStorage.mjs";
import { StoredMacro } from "../../storage/types.mjs";

const debug = registerDebug("typeagent:browser:discover:converter");

export class MacroConverter {
    constructor(private artifactsStorage: ArtifactsStorage) {}

    async convertYAMLToJSON(
        yamlMacro: YAMLMacro,
        macroId: string,
    ): Promise<StoredMacro> {
        const { macro, metadata } = yamlMacro;

        const intentSchema = generateIntentSchema(macro.name, macro.parameters);

        const intentJson = generateIntentJson(macro.name, macro.parameters);

        const macrosJson =
            macro.steps.length > 0
                ? {
                      planName: macro.description,
                      description: macro.description,
                      intentSchemaName: macro.name,
                      steps: macro.steps,
                  }
                : undefined;

        const macroDefinition = generateActionSchemaDefinition(
            macro.name,
            macro.parameters,
        );

        let artifacts: { screenshot: string[]; steps: any[] } = {
            screenshot: [],
            steps: [],
        };
        if (metadata.artifacts) {
            try {
                artifacts = await this.artifactsStorage.loadArtifacts(
                    metadata.artifacts.recordingId,
                );
            } catch (error) {
                console.warn(
                    "Could not load artifacts separately, using empty:",
                    error,
                );
            }
        }

        const detectedSchema =
            macro.author === "discovered"
                ? {
                      actionName: macro.name,
                      ...(Object.keys(macro.parameters).length > 0 && {
                          parameters: Object.fromEntries(
                              Object.entries(macro.parameters).map(
                                  ([key, param]) => [key, param.example],
                              ),
                          ),
                      }),
                  }
                : undefined;

        const scopeType = macro.scope.type as
            | "global"
            | "domain"
            | "pattern"
            | "page";

        return {
            id: macroId,
            name: macro.name,
            version: macro.version,
            description: macro.description,
            category: macro.category as any,
            tags: macro.tags || [],
            author: macro.author as "discovered" | "user",
            scope: {
                type: scopeType,
                domain: macro.scope.domain,
                priority: macro.scope.priority,
            },
            urlPatterns:
                macro.urlPatterns?.map((pattern) => ({
                    pattern: pattern.pattern,
                    type:
                        pattern.type === "prefix"
                            ? "glob"
                            : (pattern.type as "exact" | "glob" | "regex"),
                    priority: pattern.priority || 100,
                    description: `${pattern.type === "exact" ? "Exact match for" : pattern.type === "prefix" ? "Prefix match for" : "Regex match for"} ${pattern.pattern}`,
                })) || [],
            definition: {
                ...(intentSchema && { intentSchema }),
                ...(intentJson && { intentJson }),
                ...(macrosJson && { macrosJson }),
                ...(macro.steps.length > 0 && { macroSteps: macro.steps }),
                macroDefinition,
                ...(detectedSchema && { detectedSchema }),
                description: macro.description,
                screenshot: artifacts.screenshot,
                steps: artifacts.steps,
            },
            context: {},
            metadata: {
                createdAt: metadata.created,
                updatedAt: metadata.updated,
                usageCount: metadata.usageCount,
                isValid: metadata.isValid,
            },
        };
    }

    async convertJSONToYAML(
        jsonMacro: StoredMacro,
    ): Promise<{ yaml: YAMLMacro; recordingId?: string }> {
        debug(
            `[YAML_DEBUG] convertJSONToYAML input for ${jsonMacro.name}:`,
            JSON.stringify(jsonMacro, null, 2),
        );

        const { definition, metadata } = jsonMacro;

        const parameters: Record<string, YAMLParameterDefinition> = {};

        if (definition.intentJson?.parameters) {
            for (const param of definition.intentJson.parameters) {
                const paramAny = param as any;
                parameters[param.shortName] = {
                    type: param.type,
                    description: param.description,
                    required: param.required ?? false,
                    ...(param.defaultValue !== undefined && {
                        default: param.defaultValue,
                    }),
                    ...(paramAny.valueOptions && {
                        options: paramAny.valueOptions,
                    }),
                    ...(paramAny.itemType && { itemType: paramAny.itemType }),
                };
            }
        } else if (definition.detectedSchema?.parameters) {
            for (const [key, value] of Object.entries(
                definition.detectedSchema.parameters,
            )) {
                parameters[key] = {
                    type: typeof value === "string" ? "string" : "any",
                    description: `Parameter ${key}`,
                    required: false,
                    example: value,
                };
            }
        }

        debug(
            `[YAML_DEBUG] Extracted parameters for ${jsonMacro.name}:`,
            JSON.stringify(parameters, null, 2),
        );

        const definitionAny = definition as any;
        const steps: YAMLMacroStep[] =
            definitionAny.actionSteps ||
            definition.macroSteps ||
            definition.steps ||
            [];

        debug(
            `[YAML_DEBUG] Extracted steps for ${jsonMacro.name}:`,
            JSON.stringify(steps, null, 2),
        );

        let recordingId: string | undefined;
        if (
            (definition.screenshot && definition.screenshot.length > 0) ||
            (definition.steps && definition.steps.length > 0)
        ) {
            recordingId = jsonMacro.id;
            await this.artifactsStorage.saveArtifacts(recordingId, {
                screenshots: definition.screenshot || [],
                recording: definition.steps || [],
                url: jsonMacro.urlPatterns?.[0]?.pattern || "",
            });
        }

        const scopeType = jsonMacro.scope.type as "page" | "domain" | "global";

        const yamlMacro: YAMLMacro = {
            macro: {
                name: jsonMacro.name,
                version: jsonMacro.version,
                description: jsonMacro.description,
                author: jsonMacro.author,
                category: jsonMacro.category,
                tags: jsonMacro.tags,
                scope: {
                    type: scopeType,
                    domain: jsonMacro.scope.domain || "",
                    priority: jsonMacro.scope.priority,
                },
                urlPatterns: jsonMacro.urlPatterns?.map((pattern) => ({
                    pattern: pattern.pattern,
                    type: pattern.type as "exact" | "prefix" | "regex",
                    priority: pattern.priority,
                })),
                parameters,
                steps,
            },
            metadata: {
                created: metadata.createdAt,
                updated: metadata.updatedAt,
                usageCount: metadata.usageCount,
                isValid: metadata.isValid,
                ...(recordingId !== undefined && {
                    artifacts: { recordingId },
                }),
            },
        };

        debug(
            `[YAML_DEBUG] Final YAML output for ${jsonMacro.name}:`,
            JSON.stringify(yamlMacro, null, 2),
        );

        return { yaml: yamlMacro, ...(recordingId && { recordingId }) };
    }

    convertFullToMinimal(fullYaml: YAMLMacro): MinimalYAMLMacro {
        return {
            name: fullYaml.macro.name,
            description: fullYaml.macro.description,
            domain: fullYaml.macro.scope.domain,
            url: fullYaml.macro.urlPatterns?.[0]?.pattern || "",
            parameters: fullYaml.macro.parameters,
            steps: fullYaml.macro.steps,
        };
    }
}
