// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MeasurementAction =
    | PutMeasurementAction
    | GetMeasurementAction
    | RemoveMeasurementAction;

// Store these items in the vault
export type PutMeasurementAction = {
    actionName: "putMeasurement";
    parameters: {
        items: Measurement[];
    };
};

// export type PropertyNames = keyof Measurement;

export type GetMeasurementAction = {
    actionName: "getMeasurement";
    parameters: {
        filter: MeasurementFilter;
    };
};

export type RemoveMeasurementAction = {
    actionName: "removeMeasurement";
    parameters: {
        // specific measurement ids to remove
        ids: string[];
    };
};

// ISO date time string, parsable as new Date()
export type MeasurementDateTime = string;

export type MeasurementFilter = {
    types?: string[] | undefined; // Measurements types to return
    // in this value range
    valueRange?: MeasurementRange;
    // in this time range
    timeRange?: MeasurementTimeRange;
};

export type MeasurementTimeRange = {
    start?: MeasurementDateTime;
    end?: MeasurementDateTime;
};

export type MeasurementRange = {
    start?: number;
    end?: number;
    units: MeasurementUnits;
};

export type MeasurementUnits =
    | "mg"
    | "kg"
    | "grams"
    | "pounds"
    | "cm"
    | "meters"
    | "km"
    | "inches"
    | "feet"
    | "miles"
    | "liter"
    | "ml"
    | "cup"
    | "ounce"
    | "per-day"
    | "per-week"
    | "times-day"
    | "times-week"
    | string; // For custom units if others don't work

export type MeasurementQuantity = {
    value: number; // exact number
    units: MeasurementUnits;
};

export type Measurement = {
    // Use "new" for new Items
    // Otherwise MUST use an EXISTING id to update an existing item
    id?: number | "new" | undefined;
    // steps, weight, length, calories etc
    type: string;
    when?: MeasurementDateTime;
    value: MeasurementQuantity;
};
