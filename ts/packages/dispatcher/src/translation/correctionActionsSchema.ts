// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// When user say "no" or "undo" to correct previous request, we want to work with the user to repair the action
// Do NOT translate the request into action directly based on chat history, but output a description of the correction, and a proposed corrected action.
// For example, when the user say "Play some Bach for please" and result in J.S. Bach music be play, then the user say "No, I mean CPE Bach", it should
// output { actionName: "correction", parameters: { description: "I mean CPE Bach" } }.
export type CorrectionAction = UndoAction | RepairAction;
export interface RepairAction {
    actionName: "repair";
    parameters: {
        // user's correction request
        correctionRequest: string;
    };
}
export interface UndoAction {
    actionName: "undo";
    parameters: {
        // user's correction request
        correctionRequest: string;
    };
}
