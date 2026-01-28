// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { WeatherAction } from "./weatherSchema.js";

// Weather agent context (can be expanded for caching, preferences, etc.)
export type WeatherActionContext = {};

// Initialize agent context
async function initializeWeatherContext() {
    return {};
}

// Update agent context when enabled/disabled
async function updateWeatherContext(
    enable: boolean,
    context: SessionContext<WeatherActionContext>,
): Promise<void> {
    // No setup/teardown needed for now
}

// Main action execution handler
async function executeWeatherAction(
    action: TypeAgentAction<WeatherAction>,
    context: ActionContext<WeatherActionContext>,
) {
    const weatherAction = action as WeatherAction;

    try {
        switch (weatherAction.actionName) {
            case "getCurrentConditions":
                return await handleGetCurrentConditions(weatherAction, context);
            case "getForecast":
                return await handleGetForecast(weatherAction, context);
            case "getAlerts":
                return await handleGetAlerts(weatherAction, context);
            default:
                return createActionResultFromError(
                    `Unknown weather action: ${(weatherAction as any).actionName}`,
                );
        }
    } catch (error) {
        return createActionResultFromError(
            `Weather action failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// Handler for getCurrentConditions action
async function handleGetCurrentConditions(
    action: Extract<WeatherAction, { actionName: "getCurrentConditions" }>,
    context: ActionContext<WeatherActionContext>,
) {
    const { location, units = "fahrenheit" } = action.parameters;

    // Mock weather data
    const temp = units === "celsius" ? "22" : "72";
    const tempUnit = units === "celsius" ? "°C" : "°F";

    const displayText =
        `Current conditions in ${location}:\n` +
        `Temperature: ${temp}${tempUnit}\n` +
        `Conditions: Partly Cloudy\n` +
        `Humidity: 65%\n` +
        `Wind: 8 mph NW`;

    const historyText = `Got current weather for ${location}`;

    const entities = [
        {
            name: location,
            type: ["location"],
        },
    ];

    return createActionResultFromTextDisplay(
        displayText,
        historyText,
        entities,
    );
}

// Handler for getForecast action
async function handleGetForecast(
    action: Extract<WeatherAction, { actionName: "getForecast" }>,
    context: ActionContext<WeatherActionContext>,
) {
    const { location, days = 3, units = "fahrenheit" } = action.parameters;

    // Validate days parameter
    if (days < 1 || days > 7) {
        return createActionResultFromError("Days must be between 1 and 7");
    }

    // Mock forecast data
    const tempUnit = units === "celsius" ? "°C" : "°F";
    const forecasts = [];

    for (let i = 1; i <= days; i++) {
        const highF = 75 - i * 2;
        const lowF = 55 - i * 2;
        const highC = Math.round(((highF - 32) * 5) / 9);
        const lowC = Math.round(((lowF - 32) * 5) / 9);

        const high = units === "celsius" ? highC : highF;
        const low = units === "celsius" ? lowC : lowF;

        const conditions =
            i === 1 ? "Sunny" : i === 2 ? "Partly Cloudy" : "Chance of Rain";
        forecasts.push(
            `Day ${i}: ${conditions}, High: ${high}${tempUnit}, Low: ${low}${tempUnit}`,
        );
    }

    const displayText =
        `${days}-day forecast for ${location}:\n` + forecasts.join("\n");

    const historyText = `Got ${days}-day forecast for ${location}`;

    const entities = [
        {
            name: location,
            type: ["location"],
        },
    ];

    return createActionResultFromTextDisplay(
        displayText,
        historyText,
        entities,
    );
}

// Handler for getAlerts action
async function handleGetAlerts(
    action: Extract<WeatherAction, { actionName: "getAlerts" }>,
    context: ActionContext<WeatherActionContext>,
) {
    const { location } = action.parameters;

    // Mock alerts (typically none)
    const displayText = `No active weather alerts for ${location}`;
    const historyText = `Checked weather alerts for ${location}`;

    const entities = [
        {
            name: location,
            type: ["location"],
        },
    ];

    return createActionResultFromTextDisplay(
        displayText,
        historyText,
        entities,
    );
}

// Validate wildcard matches for cache matching
// TypeAgent calls this to verify if a wildcard parameter (like location) is valid
async function validateWeatherWildcardMatch(
    action: WeatherAction,
    context: SessionContext<WeatherActionContext>,
): Promise<boolean> {
    switch (action.actionName) {
        case "getCurrentConditions":
        case "getForecast":
        case "getAlerts":
            // Validate location parameter
            return validateLocation(action.parameters.location);
        default:
            return true;
    }
}

// Validate location string
// For now, accept any non-empty string
// Future: validate against known cities, valid zip codes, etc.
function validateLocation(location: string): boolean {
    if (!location || location.trim().length === 0) {
        return false;
    }

    // TODO: Add more sophisticated validation:
    // - Check against list of known cities
    // - Validate zip code format (5 digits or 5+4 format)
    // - Check against geocoding API for valid locations
    // - Support international location formats

    return true;
}

// Export agent instantiation function
export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeWeatherContext,
        updateAgentContext: updateWeatherContext,
        executeAction: executeWeatherAction,
        validateWildcardMatch: validateWeatherWildcardMatch,
    };
}
