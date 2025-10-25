// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface YAMLParameterDefinition {
    type: string;
    description: string;
    required: boolean;
    default?: any;
    options?: any[];
    itemType?: string;
    example?: any;
}

export interface YAMLMacroStep {
    action: string;
    description?: string;
    parameters?: Record<string, any>;
    items?: string;
    as?: string;
    do?: YAMLMacroStep[];
    condition?: string;
    then?: YAMLMacroStep[];
    else?: YAMLMacroStep[];
    outputs?: Record<string, string>;
    message?: string;
}

export interface YAMLURLPattern {
    pattern: string;
    type: "exact" | "prefix" | "regex";
    priority?: number;
}

export interface YAMLMacroScope {
    type: "page" | "domain" | "global";
    domain: string;
    priority: number;
}

export interface YAMLMacroDefinition {
    name: string;
    version: string;
    description: string;
    author: string;
    category: string;
    tags?: string[];
    scope: YAMLMacroScope;
    urlPatterns?: YAMLURLPattern[];
    parameters: Record<string, YAMLParameterDefinition>;
    steps: YAMLMacroStep[];
}

export interface YAMLMacroMetadata {
    created: string;
    updated: string;
    usageCount: number;
    isValid: boolean;
    artifacts?: {
        recordingId: string;
    };
}

export interface YAMLMacro {
    macro: YAMLMacroDefinition;
    metadata: YAMLMacroMetadata;
}

export interface MacroArtifacts {
    recordingId: string;
    url: string;
    timestamp: string;
    screenshots: string[];
    recording: any[];
}
