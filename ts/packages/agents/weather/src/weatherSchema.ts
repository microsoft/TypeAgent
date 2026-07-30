// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WeatherAction =
    | GetCurrentConditionsAction
    | GetForecastAction
    | GetAlertsAction;

// get the current weather conditions for a location, for example "what's the
// weather like", "what is the weather", "how's the weather in Seattle",
// "current conditions", "check the weather outside". Requires a location —
// if the user doesn't name one, ask them which location they mean instead of
// guessing.
export type GetCurrentConditionsAction = {
    actionName: "getCurrentConditions";
    parameters: {
        location: string;
        units?: "celsius" | "fahrenheit";
    };
};

// get the weather forecast (optionally for a number of days) for a location,
// for example "what's the forecast", "weather forecast for tomorrow",
// "forecast for the next 5 days in Chicago". Requires a location — if the
// user doesn't name one, ask them which location they mean instead of
// guessing.
export type GetForecastAction = {
    actionName: "getForecast";
    parameters: {
        location: string;
        days?: number; // 1-7 days
        units?: "celsius" | "fahrenheit";
    };
};

// get active weather alerts/warnings for a location, for example "weather
// alerts", "any storm warnings", "check alerts for Miami". Requires a
// location — if the user doesn't name one, ask them which location they mean
// instead of guessing.
export type GetAlertsAction = {
    actionName: "getAlerts";
    parameters: {
        location: string;
    };
};
