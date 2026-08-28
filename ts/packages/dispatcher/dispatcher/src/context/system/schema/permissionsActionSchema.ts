// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PermissionsAction = SetPermissionApprovalAction;

// Enable or disable automatic approval of eligible agent permissions for the
// current session.
export type SetPermissionApprovalAction = {
    actionName: "setPermissionApproval";
    parameters: {
        enable: boolean;
    };
};
