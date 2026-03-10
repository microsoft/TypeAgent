// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    BrowserAgentInvokeFunctions,
    ExtensionLocalInvokeFunctions,
} from "../../common/serviceTypes.mjs";
import type { PlatformServices } from "../../common/platformServices.mjs";
import { createChromePlatform } from "./chromePlatform";
import { createElectronPlatform } from "./electronPlatform";
import { createChromeRpcClient } from "./chromeRpcClient";
import { createElectronRpcClient } from "./electronRpcClient";

type AllInvokeFunctions = BrowserAgentInvokeFunctions &
    Partial<ExtensionLocalInvokeFunctions>;

export interface ServiceClient {
    rpc: {
        invoke: (method: string, ...args: any[]) => Promise<any>;
    };
    platform: PlatformServices;
}

/**
 * Creates a unified service client for extension views.
 * Automatically detects Chrome vs Electron environment and uses the
 * appropriate RPC transport and platform services.
 *
 * This replaces ChromeExtensionService and ElectronExtensionService.
 */
export function createServiceClient(): ServiceClient | undefined {
    const electronAPI = (window as any).electronAPI;

    if (electronAPI?.sendRpcMessage) {
        const result = createElectronRpcClient<AllInvokeFunctions>();
        if (result) {
            return {
                rpc: result.rpc as any,
                platform: createElectronPlatform(),
            };
        }
    }

    if (typeof chrome !== "undefined" && chrome.runtime) {
        const result = createChromeRpcClient<AllInvokeFunctions>();
        return {
            rpc: result.rpc as any,
            platform: createChromePlatform(),
        };
    }

    return undefined;
}
