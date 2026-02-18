// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Email Provider Factory
 *
 * Creates the appropriate email provider based on configuration
 */

import {
    IEmailProvider,
    EmailProviderType,
    EmailProviderConfig,
} from "./emailProvider.js";
import { getMSGraphEmailProvider } from "./msGraphEmailProvider.js";
import { getGoogleEmailClient } from "./googleEmailClient.js";
import { MailClient } from "./mailClient.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:graphUtils:emailfactory");

/**
 * Detect which email provider is configured based on environment variables
 */
export function detectConfiguredEmailProvider(): EmailProviderType | undefined {
    // Check for Microsoft Graph configuration
    const hasMSGraph = !!(
        process.env.MSGRAPH_APP_CLIENTID || process.env.MSGRAPH_APP_TENANTID
    );

    // Check for Google configuration (same env vars as calendar)
    const hasGoogle = !!(
        process.env.GOOGLE_CALENDAR_CLIENT_ID &&
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    );

    if (hasMSGraph && hasGoogle) {
        debug("Both Microsoft Graph and Google are configured for email");
        // Default to Microsoft if both are configured (existing behavior)
        return "microsoft";
    }

    if (hasMSGraph) {
        debug("Microsoft Graph is configured for email");
        return "microsoft";
    }

    if (hasGoogle) {
        debug("Google Gmail is configured for email");
        return "google";
    }

    debug("No email provider configured");
    return undefined;
}

/**
 * Create an email provider based on type
 */
export function createEmailProvider(
    providerType: EmailProviderType,
    existingMSGraphClient?: MailClient,
): IEmailProvider {
    switch (providerType) {
        case "microsoft":
            debug("Creating Microsoft Graph email provider");
            return getMSGraphEmailProvider(existingMSGraphClient);

        case "google":
            debug("Creating Google Gmail provider");
            return getGoogleEmailClient();

        default:
            throw new Error(`Unknown email provider type: ${providerType}`);
    }
}

/**
 * Create an email provider from configuration
 */
export function createEmailProviderFromConfig(
    config?: EmailProviderConfig,
    existingMSGraphClient?: MailClient,
): IEmailProvider | undefined {
    // If explicit config provided, use it
    if (config?.provider) {
        return createEmailProvider(config.provider, existingMSGraphClient);
    }

    // Otherwise, auto-detect from environment
    const detectedProvider = detectConfiguredEmailProvider();
    if (detectedProvider) {
        return createEmailProvider(detectedProvider, existingMSGraphClient);
    }

    debug("No email provider available");
    return undefined;
}

/**
 * Get all available email provider types based on configuration
 */
export function getAvailableEmailProviders(): EmailProviderType[] {
    const providers: EmailProviderType[] = [];

    if (process.env.MSGRAPH_APP_CLIENTID || process.env.MSGRAPH_APP_TENANTID) {
        providers.push("microsoft");
    }

    if (
        process.env.GOOGLE_CALENDAR_CLIENT_ID &&
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    ) {
        providers.push("google");
    }

    return providers;
}

/**
 * Check if a specific email provider is configured
 */
export function isEmailProviderConfigured(
    providerType: EmailProviderType,
): boolean {
    switch (providerType) {
        case "microsoft":
            return !!(
                process.env.MSGRAPH_APP_CLIENTID ||
                process.env.MSGRAPH_APP_TENANTID
            );
        case "google":
            return !!(
                process.env.GOOGLE_CALENDAR_CLIENT_ID &&
                process.env.GOOGLE_CALENDAR_CLIENT_SECRET
            );
        default:
            return false;
    }
}
