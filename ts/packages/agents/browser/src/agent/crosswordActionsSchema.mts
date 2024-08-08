// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordActions = EnterTextAction | GetClueAction | UnknownAction;

export type EnterTextAction = {
  actionName: "enterText";
  parameters: {
    value: string;
    clueNumber: number;
    clueDirection: "across" | "down";
  };
};

export type GetClueAction = {
  actionName: "getClueValue";
  parameters: {
    clueNumber: number;
    clueDirection: "across" | "down";
  };
};

export type UnknownAction = {
  actionName: "unknown";
  parameters: {
    // text typed by the user that the system did not understand
    text: string;
  };
};
