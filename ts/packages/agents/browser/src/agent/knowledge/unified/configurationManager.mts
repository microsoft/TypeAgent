// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { UnifiedExtractionMode, UnifiedModeConfig } from "./types.mjs";

export interface ExtractionEnvironmentConfig {
    defaultMode: UnifiedExtractionMode;
    enableAI: boolean;
    maxConcurrency: number;
    timeoutMs: number;
    qualityThreshold: number;
    enableAnalytics: boolean;
    enableQualityMonitoring: boolean;
    batchSizeLimit: number;
}

export interface UserPreferences {
    defaultIndexMode: UnifiedExtractionMode;
    defaultImportMode: UnifiedExtractionMode;
    enableBatchAI: boolean;
    qualityThreshold: number;
    maxProcessingTime: number;
    notificationLevel: 'none' | 'errors' | 'progress' | 'all';
    preferredConcurrency: number;
}

export const EXTRACTION_ENVIRONMENTS: Record<string, ExtractionEnvironmentConfig> = {
    development: {
        defaultMode: 'basic',
        enableAI: false,
        maxConcurrency: 2,
        timeoutMs: 30000,
        qualityThreshold: 0.3,
        enableAnalytics: true,
        enableQualityMonitoring: true,
        batchSizeLimit: 10
    },
    staging: {
        defaultMode: 'content',
        enableAI: true,
        maxConcurrency: 5,
        timeoutMs: 60000,
        qualityThreshold: 0.4,
        enableAnalytics: true,
        enableQualityMonitoring: true,
        batchSizeLimit: 100
    },
    production: {
        defaultMode: 'content',
        enableAI: true,
        maxConcurrency: 10,
        timeoutMs: 120000,
        qualityThreshold: 0.5,
        enableAnalytics: true,
        enableQualityMonitoring: false,
        batchSizeLimit: 1000
    }
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
    defaultIndexMode: 'content',
    defaultImportMode: 'basic',
    enableBatchAI: true,
    qualityThreshold: 0.4,
    maxProcessingTime: 300000,
    notificationLevel: 'progress',
    preferredConcurrency: 5
};

export class ConfigurationManager {
    private environment: string;
    private userPreferences: UserPreferences;
    private environmentConfig: ExtractionEnvironmentConfig;
    
    constructor(environment: string = 'production', userPreferences?: Partial<UserPreferences>) {
        this.environment = environment;
        this.environmentConfig = EXTRACTION_ENVIRONMENTS[environment] || EXTRACTION_ENVIRONMENTS.production;
        this.userPreferences = { ...DEFAULT_USER_PREFERENCES, ...userPreferences };
        
        // Use environment for logging
        console.log(`Initialized ConfigurationManager for ${environment} environment`);
    }
    
    getDefaultMode(operation: 'index' | 'import' | 'extract'): UnifiedExtractionMode {
        switch (operation) {
            case 'index':
                return this.userPreferences.defaultIndexMode;
            case 'import':
                return this.userPreferences.defaultImportMode;
            case 'extract':
                return this.environmentConfig.defaultMode;
            default:
                return this.environmentConfig.defaultMode;
        }
    }
    
    getModeConfig(mode: UnifiedExtractionMode): UnifiedModeConfig {
        const baseConfig = this.getBaseModeConfig(mode);
        
        return {
            ...baseConfig,
            maxConcurrentExtractions: Math.min(
                baseConfig.maxConcurrentExtractions,
                this.environmentConfig.maxConcurrency
            ),
            qualityThreshold: Math.max(
                baseConfig.qualityThreshold,
                this.environmentConfig.qualityThreshold
            )
        };
    }
    
    private getBaseModeConfig(mode: UnifiedExtractionMode): UnifiedModeConfig {
        const configs: Record<UnifiedExtractionMode, UnifiedModeConfig> = {
            basic: {
                mode: 'basic',
                enableAI: false,
                enableActionDetection: false,
                enableRelationshipExtraction: false,
                maxCharsPerChunk: 500,
                qualityThreshold: 0.2,
                maxConcurrentExtractions: 10
            },
            content: {
                mode: 'content',
                enableAI: true,
                enableActionDetection: false,
                enableRelationshipExtraction: false,
                maxCharsPerChunk: 1000,
                qualityThreshold: 0.3,
                maxConcurrentExtractions: 5
            },
            actions: {
                mode: 'actions',
                enableAI: true,
                enableActionDetection: true,
                enableRelationshipExtraction: false,
                maxCharsPerChunk: 1200,
                qualityThreshold: 0.35,
                maxConcurrentExtractions: 3
            },
            full: {
                mode: 'full',
                enableAI: true,
                enableActionDetection: true,
                enableRelationshipExtraction: true,
                maxCharsPerChunk: 1500,
                qualityThreshold: 0.4,
                maxConcurrentExtractions: 2
            }
        };
        
        return configs[mode];
    }
    
    isAIAvailable(): boolean {
        return this.environmentConfig.enableAI;
    }
    
    getEnvironment(): string {
        return this.environment;
    }
}

// Global configuration instance
let globalConfig: ConfigurationManager | null = null;

export function getGlobalConfig(): ConfigurationManager {
    if (!globalConfig) {
        globalConfig = new ConfigurationManager('production');
    }
    return globalConfig;
}
