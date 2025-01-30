// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type FindPageComponents = {
  actionName: "findPageComponents";
};

export type FindUserActions = {
  actionName: "findUserActions";
  parameters: {
    allowDuplicates?: boolean;
  };
};

export type SummarizePage = {
  actionName: "summarizePage";
};

export type SaveUserActions = {
  actionName: "saveUserActions";
  parameters: {
    actionListId?: string;
    agentName?: string;
  };
};

export type AddUserAction = {
  actionName: "addUserAction";
  parameters: {
    actionName?: string;
    actionDescription?: string;
    agentName?: string;
  };
};

export type SchemaDiscoveryActions =
  | FindPageComponents
  | FindUserActions
  | SummarizePage
  | SaveUserActions
  | AddUserAction;
