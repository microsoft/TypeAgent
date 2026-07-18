// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface PlatformServices {
    storage: {
        get(keys: string[]): Promise<Record<string, any>>;
        set(items: Record<string, any>): Promise<void>;
    };
    tabs: {
        getActiveTab(): Promise<{
            id: number;
            url: string;
            title: string;
        } | null>;
        createTab(url: string, active?: boolean): Promise<any>;
    };
    connection: {
        checkWebSocket(): Promise<{ connected: boolean }>;
    };
}
