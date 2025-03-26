// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WebPlanResult = {
    // message shown to the user. This may be a confirmation message that the task was completed,
    // or a message indicating the task was not completed and asking for more infomration from the user.
    message: string;
    // indicates whether the objective for the current plan has been met
    isTaskComplete: boolean;
    possibleUserFolloupActions?: string[];
};
