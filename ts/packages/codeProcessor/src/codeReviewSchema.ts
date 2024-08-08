// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Severity = "S1" | "S2" | "S3";

export type LineReview = {
    lineNumber: number;
    comment: string;
    severity: Severity;
};

export type Bug = {
    lineNumber: number;
    comment: string;
    severity: Severity;
};

export type Breakpoint = {
    lineNumber: number; // line where breakpoint should be set
    comment: string;
    priority: "P1" | "P2" | "P3";
};

// Hint: variables and constants may be referenced in closures
export type CodeReview = {
    comments?: LineReview[];
    bugs?: Bug[]; // line where bug is
};

export type BreakPointSuggestions = {
    // Best places to set breakpoints to debug the user's issue
    breakPoints: Breakpoint[];
};
