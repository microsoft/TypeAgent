// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PowerShellDataActions =
    | ReadJsonAction
    | WriteJsonAction
    | ReadCsvAction
    | WriteCsvAction
    | FilterCsvAction
    | ConvertFormatAction;

// Read and parse a JSON file
export type ReadJsonAction = {
    actionName: "readJson";
    parameters: {
        // Path to the JSON file
        path: string;
        // Dot-notation path to extract (e.g., "config.database.host")
        propertyPath?: string;
    };
};

// Write data to a JSON file
export type WriteJsonAction = {
    actionName: "writeJson";
    parameters: {
        // Path to the JSON file
        path: string;
        // Data to write (as JSON string)
        data: string;
    };
};

// Read and parse a CSV file
export type ReadCsvAction = {
    actionName: "readCsv";
    parameters: {
        // Path to the CSV file
        path: string;
        // Delimiter character (default: comma)
        delimiter?: string;
    };
};

// Write data to a CSV file
export type WriteCsvAction = {
    actionName: "writeCsv";
    parameters: {
        // Path to the CSV file
        path: string;
        // Data to write (as JSON array string)
        data: string;
    };
};

// Filter rows in a CSV file
export type FilterCsvAction = {
    actionName: "filterCsv";
    parameters: {
        // Path to the CSV file
        path: string;
        // Column to filter on
        column: string;
        // Pattern to match
        pattern: string;
    };
};

// Convert between data formats
export type ConvertFormatAction = {
    actionName: "convertFormat";
    parameters: {
        // Input file path
        input: string;
        // Output format
        format: "json" | "csv" | "xml";
    };
};
