// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PaleoBioDbActions =
    | ZoomIn
    | ZoomOut
    | ZoomReset
    | SetGeologicTimescale
    | SetTaxonomicGroup
    | TogglePaleogeographyMap
    | SetMapLocation
    | PanMap
    | ClearFilters;

export type ZoomIn = {
    actionName: "zoomIn";
};

export type ZoomOut = {
    actionName: "zoomOut";
};

export type ZoomReset = {
    actionName: "zoomReset";
};

// Sets the geologic time for fossil records
// IMPORTANT: Convert the user's into in the precise geologic age, epoch or period
// Example: user: "Set the time to 50 million years ago"
//          assistant: {
// "actionName": "setGeologicTimescale",
// "parameters": {
//   "geologicTime": "Eocene"
// }
// }
// IMPORTANT: Correct any typos in the user's input
export type SetGeologicTimescale = {
    actionName: "setGeologicTimescale";
    parameters: {
        geologicTime: string; // The Geologic time e.g. Cenozoic, Mesozoic, Devonian etc.
    };
};

// This sets the taxonomic group used in the database
// IMPORTANT: Convert the user's into in the precise taxonomic group in latin
// Example: user: "Set the group to mammals"
//          assistant: {
// "actionName": "setTaxonomicGroup",
// "parameters": {
//   "taxa": "Mammalia"
// }
// }
// IMPORTANT: Correct any typos in the user's input
export type SetTaxonomicGroup = {
    actionName: "setTaxonomicGroup";
    parameters: {
        taxa: string; // The taxonomic group e.g. Mollusca, Carnivora etc.
    };
};

// This updates the visible map to center on the specified location
// IMPORTANT: The location should exist as a geographic entity
// Example: user: "Set the location to utah"
//          assistant: {
// "actionName": "setMapLocation",
// "parameters": {
//   "locationName":"Utah",
//  }
// }
export type SetMapLocation = {
    actionName: "setMapLocation";
    parameters: {
        locationName: string; // The name of the location
    };
};

// This updates the map to show different continent states
export type TogglePaleogeographyMap = {
    actionName: "togglePaleogeographyMap";
    parameters: {
        on: boolean;
    };
};

export type PanMap = {
    actionName: "panMap";
    parameters: {
        direction: PanDirections; // The direction to pan on the map.
    };
};

export type PanDirections = "up" | "down" | "left" | "right";

export type ClearFilters = {
    actionName: "clearFilters";
    parameters: {
        geologicTime: boolean;
        taxa: boolean;
        all: boolean;
    };
};
