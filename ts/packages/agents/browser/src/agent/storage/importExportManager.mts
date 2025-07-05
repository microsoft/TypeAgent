// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileManager } from "./fileManager.mjs";
import { ActionValidator } from "./validator.mjs";
import { 
    StoredAction,
    ExportResult,
    ImportResult,
    ImportPreview,
    BackupResult,
    RestoreResult,
    ExportFormat,
    ActionFilter
} from "./types.mjs";

/**
 * ImportExportManager - Data portability and backup management
 * 
 * Provides comprehensive import/export capabilities including:
 * - Action export in multiple formats (JSON, CSV)
 * - Action import with validation and conflict resolution
 * - Full system backup and restore
 * - Import preview and validation
 * - Data migration utilities
 */
export class ImportExportManager {
    private fileManager: FileManager;
    private validator: ActionValidator;

    constructor(fileManager: FileManager, validator: ActionValidator) {
        this.fileManager = fileManager;
        this.validator = validator;
    }

    /**
     * Export actions with optional filtering
     */
    async exportActions(
        getAllActions: () => Promise<StoredAction[]>,
        format: ExportFormat = 'json',
        filter?: ActionFilter
    ): Promise<ExportResult> {
        try {
            const startTime = performance.now();
            
            // Get all actions
            let actions = await getAllActions();

            // Apply filters if provided
            if (filter) {
                actions = this.applyExportFilter(actions, filter);
            }

            // Generate export data based on format
            let exportData: string;
            let filename: string;
            
            switch (format) {
                case 'json':
                    exportData = await this.exportToJSON(actions);
                    filename = `typeagent-actions-${this.getTimestamp()}.json`;
                    break;
                case 'csv':
                    exportData = await this.exportToCSV(actions);
                    filename = `typeagent-actions-${this.getTimestamp()}.csv`;
                    break;
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }

            const exportTime = performance.now() - startTime;

            return {
                success: true,
                data: exportData,
                filename,
                format,
                actionCount: actions.length,
                exportTime,
                size: new Blob([exportData]).size
            };

        } catch (error) {
            console.error('Export failed:', error);
            return {
                success: false,
                error: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                format,
                actionCount: 0,
                exportTime: 0,
                size: 0
            };
        }
    }

    /**
     * Preview import data before actual import
     */
    async previewImport(
        importData: string,
        format: ExportFormat = 'json'
    ): Promise<ImportPreview> {
        try {
            let actions: StoredAction[];

            switch (format) {
                case 'json':
                    actions = await this.parseJSONImport(importData);
                    break;
                case 'csv':
                    actions = await this.parseCSVImport(importData);
                    break;
                default:
                    throw new Error(`Unsupported import format: ${format}`);
            }

            // Validate actions
            const validationResults = actions.map(action => ({
                action,
                validation: this.validator.validateAction(action)
            }));

            const validActions = validationResults.filter(result => result.validation.isValid);
            const invalidActions = validationResults.filter(result => !result.validation.isValid);

            // For preview, we can't easily check conflicts without access to existing actions
            // This would be handled by the calling code that has access to the store

            return {
                totalActions: actions.length,
                validActions: validActions.length,
                invalidActions: invalidActions.length,
                conflicts: 0, // Will be determined during actual import
                preview: validActions.slice(0, 5).map(result => result.action), // Show first 5 valid actions
                validationErrors: invalidActions.map(result => ({
                    actionId: result.action.id,
                    actionName: result.action.name,
                    errors: result.validation.errors.map(e => e.message)
                })),
                conflictingActions: [] // Will be determined during actual import
            };

        } catch (error) {
            console.error('Import preview failed:', error);
            return {
                totalActions: 0,
                validActions: 0,
                invalidActions: 0,
                conflicts: 0,
                preview: [],
                validationErrors: [],
                conflictingActions: [],
                error: `Import preview failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Import actions from external data
     */
    async importActions(
        importData: string,
        saveAction: (action: StoredAction) => Promise<{success: boolean, error?: string}>,
        format: ExportFormat = 'json',
        options: {
            skipInvalid?: boolean;
            overwriteExisting?: boolean;
            generateNewIds?: boolean;
        } = {}
    ): Promise<ImportResult> {
        try {
            const startTime = performance.now();
            const {
                skipInvalid = true,
                overwriteExisting = false,
                generateNewIds = false
            } = options;

            let actions: StoredAction[];

            switch (format) {
                case 'json':
                    actions = await this.parseJSONImport(importData);
                    break;
                case 'csv':
                    actions = await this.parseCSVImport(importData);
                    break;
                default:
                    throw new Error(`Unsupported import format: ${format}`);
            }

            const results = {
                imported: 0,
                skipped: 0,
                errors: 0,
                errorDetails: [] as Array<{actionId: string, error: string}>
            };

            for (const action of actions) {
                try {
                    // Validate action
                    const validation = this.validator.validateAction(action);
                    if (!validation.isValid) {
                        if (skipInvalid) {
                            results.skipped++;
                            continue;
                        } else {
                            results.errors++;
                            results.errorDetails.push({
                                actionId: action.id,
                                error: `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`
                            });
                            continue;
                        }
                    }

                    // Handle ID conflicts
                    let actionToSave = action;
                    if (generateNewIds) {
                        actionToSave = {
                            ...action,
                            id: this.generateNewId(),
                            metadata: {
                                ...action.metadata,
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString()
                            }
                        };
                    }

                    // Save action
                    const saveResult = await saveAction(actionToSave);
                    if (saveResult.success) {
                        results.imported++;
                    } else {
                        if (saveResult.error?.includes('already exists') && !overwriteExisting) {
                            results.skipped++;
                        } else {
                            results.errors++;
                            results.errorDetails.push({
                                actionId: action.id,
                                error: saveResult.error || 'Unknown save error'
                            });
                        }
                    }

                } catch (error) {
                    results.errors++;
                    results.errorDetails.push({
                        actionId: action.id,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            }

            const importTime = performance.now() - startTime;

            return {
                success: results.errors === 0 || results.imported > 0,
                totalActions: actions.length,
                imported: results.imported,
                skipped: results.skipped,
                errors: results.errors,
                importTime,
                errorDetails: results.errorDetails
            };

        } catch (error) {
            console.error('Import failed:', error);
            return {
                success: false,
                totalActions: 0,
                imported: 0,
                skipped: 0,
                errors: 1,
                importTime: 0,
                errorDetails: [{
                    actionId: 'unknown',
                    error: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                }]
            };
        }
    }

    /**
     * Create a full system backup
     */
    async createBackup(
        getAllActions: () => Promise<StoredAction[]>,
        getAllDomains: () => Promise<string[]>,
        getDomainConfig: (domain: string) => Promise<any>
    ): Promise<BackupResult> {
        try {
            const startTime = performance.now();
            const backupId = `backup-${this.getTimestamp()}`;

            // Get all data
            const actions = await getAllActions();
            const domains = await getAllDomains();
            const domainConfigs: Record<string, any> = {};

            for (const domain of domains) {
                try {
                    const config = await getDomainConfig(domain);
                    if (config) {
                        domainConfigs[domain] = config;
                    }
                } catch (error) {
                    console.warn(`Failed to backup config for domain ${domain}:`, error);
                }
            }

            // Create backup data structure
            const backupData = {
                metadata: {
                    backupId,
                    timestamp: new Date().toISOString(),
                    version: '1.0',
                    totalActions: actions.length,
                    totalDomains: domains.length
                },
                actions,
                domainConfigs,
                domains
            };

            // Serialize backup
            const backupString = JSON.stringify(backupData, null, 2);
            const backupSize = new Blob([backupString]).size;

            // Save backup to file system
            const backupPath = `backups/${backupId}.json`;
            await this.fileManager.createDirectory('backups');
            await this.fileManager.writeText(backupPath, backupString);

            const backupTime = performance.now() - startTime;

            return {
                success: true,
                backupId,
                filename: `${backupId}.json`,
                data: backupString,
                size: backupSize,
                actionCount: actions.length,
                domainCount: domains.length,
                backupTime
            };

        } catch (error) {
            console.error('Backup creation failed:', error);
            return {
                success: false,
                error: `Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                backupId: '',
                filename: '',
                size: 0,
                actionCount: 0,
                domainCount: 0,
                backupTime: 0
            };
        }
    }

    /**
     * Restore from backup
     */
    async restoreFromBackup(
        backupData: string,
        saveAction: (action: StoredAction) => Promise<{success: boolean, error?: string}>,
        saveDomainConfig: (config: any) => Promise<{success: boolean, error?: string}>,
        options: {
            clearExisting?: boolean;
            skipInvalid?: boolean;
        } = {}
    ): Promise<RestoreResult> {
        try {
            const startTime = performance.now();
            const { clearExisting = false, skipInvalid = true } = options;

            // Parse backup data
            const backup = JSON.parse(backupData);
            
            // Validate backup structure
            if (!backup.metadata || !backup.actions || !Array.isArray(backup.actions)) {
                throw new Error('Invalid backup format');
            }

            const results = {
                actionsRestored: 0,
                domainsRestored: 0,
                actionsSkipped: 0,
                domainsSkipped: 0,
                errors: [] as string[]
            };

            // Restore actions
            for (const action of backup.actions) {
                try {
                    // Validate action
                    const validation = this.validator.validateAction(action);
                    if (!validation.isValid) {
                        if (skipInvalid) {
                            results.actionsSkipped++;
                            continue;
                        } else {
                            results.errors.push(`Action ${action.id}: Validation failed`);
                            continue;
                        }
                    }

                    // Restore timestamps if clearing existing
                    const actionToRestore = clearExisting ? {
                        ...action,
                        metadata: {
                            ...action.metadata,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        }
                    } : action;

                    const saveResult = await saveAction(actionToRestore);
                    if (saveResult.success) {
                        results.actionsRestored++;
                    } else {
                        results.errors.push(`Action ${action.id}: ${saveResult.error}`);
                    }

                } catch (error) {
                    results.errors.push(`Action ${action.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Restore domain configurations
            if (backup.domainConfigs) {
                for (const [domain, config] of Object.entries(backup.domainConfigs)) {
                    try {
                        const saveResult = await saveDomainConfig(config);
                        if (saveResult.success) {
                            results.domainsRestored++;
                        } else {
                            results.errors.push(`Domain ${domain}: ${saveResult.error}`);
                        }
                    } catch (error) {
                        results.errors.push(`Domain ${domain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                }
            }

            const restoreTime = performance.now() - startTime;

            return {
                success: results.errors.length === 0 || results.actionsRestored > 0,
                backupId: backup.metadata.backupId,
                actionsRestored: results.actionsRestored,
                domainsRestored: results.domainsRestored,
                actionsSkipped: results.actionsSkipped,
                domainsSkipped: results.domainsSkipped,
                errors: results.errors,
                restoreTime
            };

        } catch (error) {
            console.error('Restore failed:', error);
            return {
                success: false,
                error: `Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                backupId: '',
                actionsRestored: 0,
                domainsRestored: 0,
                actionsSkipped: 0,
                domainsSkipped: 0,
                errors: [error instanceof Error ? error.message : 'Unknown error'],
                restoreTime: 0
            };
        }
    }

    // Private helper methods

    /**
     * Apply export filter to actions
     */
    private applyExportFilter(actions: StoredAction[], filter: ActionFilter): StoredAction[] {
        let filtered = actions;

        if (filter.categories && filter.categories.length > 0) {
            filtered = filtered.filter(action => filter.categories!.includes(action.category));
        }

        if (filter.authors && filter.authors.length > 0) {
            filtered = filtered.filter(action => filter.authors!.includes(action.author));
        }

        if (filter.domains && filter.domains.length > 0) {
            filtered = filtered.filter(action => 
                action.scope.domain && filter.domains!.includes(action.scope.domain)
            );
        }

        if (filter.scopes && filter.scopes.length > 0) {
            filtered = filtered.filter(action => filter.scopes!.includes(action.scope.type));
        }

        if (filter.tags && filter.tags.length > 0) {
            filtered = filtered.filter(action => 
                filter.tags!.some(tag => 
                    action.tags.some(actionTag => 
                        actionTag.toLowerCase() === tag.toLowerCase()
                    )
                )
            );
        }

        if (filter.minUsage !== undefined) {
            filtered = filtered.filter(action => action.metadata.usageCount >= filter.minUsage!);
        }

        if (filter.maxUsage !== undefined) {
            filtered = filtered.filter(action => action.metadata.usageCount <= filter.maxUsage!);
        }

        if (filter.createdAfter) {
            const afterDate = new Date(filter.createdAfter);
            filtered = filtered.filter(action => new Date(action.metadata.createdAt) >= afterDate);
        }

        if (filter.createdBefore) {
            const beforeDate = new Date(filter.createdBefore);
            filtered = filtered.filter(action => new Date(action.metadata.createdAt) <= beforeDate);
        }

        return filtered;
    }

    /**
     * Export actions to JSON format
     */
    private async exportToJSON(actions: StoredAction[]): Promise<string> {
        const exportData = {
            metadata: {
                exportVersion: '1.0',
                exportTimestamp: new Date().toISOString(),
                totalActions: actions.length,
                exportedBy: 'TypeAgent Actions Store'
            },
            actions
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Export actions to CSV format
     */
    private async exportToCSV(actions: StoredAction[]): Promise<string> {
        const headers = [
            'ID',
            'Name',
            'Description',
            'Category',
            'Author',
            'ScopeType',
            'Domain',
            'Tags',
            'UsageCount',
            'CreatedAt',
            'LastUsed'
        ];

        const rows = actions.map(action => [
            action.id,
            this.escapeCsvField(action.name),
            this.escapeCsvField(action.description),
            action.category,
            action.author,
            action.scope.type,
            action.scope.domain || '',
            this.escapeCsvField(action.tags.join(';')),
            action.metadata.usageCount.toString(),
            action.metadata.createdAt,
            action.metadata.lastUsed || ''
        ]);

        const csvContent = [headers, ...rows]
            .map(row => row.join(','))
            .join('\n');

        return csvContent;
    }

    /**
     * Parse JSON import data
     */
    private async parseJSONImport(data: string): Promise<StoredAction[]> {
        const parsed = JSON.parse(data);

        // Handle different JSON formats
        if (parsed.actions && Array.isArray(parsed.actions)) {
            // Standard export format
            return parsed.actions;
        } else if (Array.isArray(parsed)) {
            // Simple array format
            return parsed;
        } else {
            throw new Error('Invalid JSON format: Expected actions array');
        }
    }

    /**
     * Parse CSV import data
     */
    private async parseCSVImport(data: string): Promise<StoredAction[]> {
        const lines = data.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            throw new Error('CSV must have at least a header and one data row');
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const actions: StoredAction[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCsvLine(lines[i]);
            if (values.length !== headers.length) {
                console.warn(`Skipping malformed CSV line ${i + 1}`);
                continue;
            }

            try {
                const action = this.csvRowToAction(headers, values);
                actions.push(action);
            } catch (error) {
                console.warn(`Failed to parse CSV line ${i + 1}:`, error);
            }
        }

        return actions;
    }

    /**
     * Convert CSV row to StoredAction
     */
    private csvRowToAction(headers: string[], values: string[]): StoredAction {
        const getValue = (header: string): string => {
            const index = headers.indexOf(header);
            return index >= 0 ? values[index] : '';
        };

        // Create a basic action from CSV data
        const defaultAction = this.validator.createDefaultAction();
        const lastUsedValue = getValue('LastUsed');
        const domainValue = getValue('Domain');
        
        const action: StoredAction = {
            ...defaultAction,
            id: getValue('ID') || this.generateNewId(),
            name: getValue('Name'),
            description: getValue('Description'),
            category: getValue('Category') as any || 'custom',
            author: getValue('Author') as any || 'user',
            scope: {
                type: getValue('ScopeType') as any || 'page',
                priority: 50,
                ...(domainValue ? { domain: domainValue } : {})
            },
            tags: getValue('Tags') ? getValue('Tags').split(';') : [],
            metadata: {
                ...defaultAction.metadata,
                usageCount: parseInt(getValue('UsageCount')) || 0,
                createdAt: getValue('CreatedAt') || new Date().toISOString(),
                ...(lastUsedValue ? { lastUsed: lastUsedValue } : {}),
                updatedAt: new Date().toISOString()
            }
        };

        return action;
    }

    /**
     * Escape CSV field
     */
    private escapeCsvField(field: string): string {
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }

    /**
     * Parse CSV line handling quoted fields
     */
    private parseCsvLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                // Field separator
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current.trim());
        return result;
    }

    /**
     * Generate new unique ID
     */
    private generateNewId(): string {
        return 'imported-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Get timestamp string for filenames
     */
    private getTimestamp(): string {
        return new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
               new Date().toISOString().split('T')[1].substring(0, 8).replace(/:/g, '-');
    }
}
