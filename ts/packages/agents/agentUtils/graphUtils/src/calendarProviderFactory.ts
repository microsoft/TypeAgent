// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Calendar Provider Factory
 *
 * Creates the appropriate calendar provider based on configuration
 */

import {
    ICalendarProvider,
    CalendarProviderType,
    CalendarProviderConfig,
} from "./calendarProvider.js";
import { getMSGraphCalendarProvider } from "./msGraphCalendarProvider.js";
import { getGoogleCalendarClient } from "./googleCalendarClient.js";
import { CalendarClient } from "./calendarClient.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:graphUtils:calendarfactory");

/**
 * Detect which calendar provider is configured based on environment variables
 */
export function detectConfiguredProvider(): CalendarProviderType | undefined {
    // Check for Microsoft Graph configuration
    const hasMSGraph = !!(
        process.env.MSGRAPH_APP_CLIENTID || process.env.MSGRAPH_APP_TENANTID
    );

    // Check for Google Calendar configuration
    const hasGoogle = !!(
        process.env.GOOGLE_CALENDAR_CLIENT_ID &&
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    );

    if (hasMSGraph && hasGoogle) {
        debug("Both Microsoft Graph and Google Calendar are configured");
        // Default to Microsoft if both are configured (existing behavior)
        // User can override via explicit configuration
        return "microsoft";
    }

    if (hasMSGraph) {
        debug("Microsoft Graph is configured");
        return "microsoft";
    }

    if (hasGoogle) {
        debug("Google Calendar is configured");
        return "google";
    }

    debug("No calendar provider configured");
    return undefined;
}

/**
 * Create a calendar provider based on type
 */
export function createCalendarProvider(
    providerType: CalendarProviderType,
    existingMSGraphClient?: CalendarClient,
): ICalendarProvider {
    switch (providerType) {
        case "microsoft":
            debug("Creating Microsoft Graph calendar provider");
            return getMSGraphCalendarProvider(existingMSGraphClient);

        case "google":
            debug("Creating Google Calendar provider");
            return getGoogleCalendarClient();

        default:
            throw new Error(`Unknown calendar provider type: ${providerType}`);
    }
}

/**
 * Create a calendar provider from configuration
 */
export function createCalendarProviderFromConfig(
    config?: CalendarProviderConfig,
    existingMSGraphClient?: CalendarClient,
): ICalendarProvider | undefined {
    // If explicit config provided, use it
    if (config?.provider) {
        return createCalendarProvider(config.provider, existingMSGraphClient);
    }

    // Otherwise, auto-detect from environment
    const detectedProvider = detectConfiguredProvider();
    if (detectedProvider) {
        return createCalendarProvider(detectedProvider, existingMSGraphClient);
    }

    debug("No calendar provider available");
    return undefined;
}

/**
 * Get all available calendar provider types based on configuration
 */
export function getAvailableProviders(): CalendarProviderType[] {
    const providers: CalendarProviderType[] = [];

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
 * Check if a specific provider is configured
 */
export function isProviderConfigured(providerType: CalendarProviderType): boolean {
    switch (providerType) {
        case "microsoft":
            return !!(
                process.env.MSGRAPH_APP_CLIENTID || process.env.MSGRAPH_APP_TENANTID
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
