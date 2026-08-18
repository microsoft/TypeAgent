// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared by the `@notify status` command and the testStatusNotice action.
// It lives in its own module so the action handler can use it without importing
// the command tree, which depends back on the system agent.
export const STATUS_NOTICE_DEFAULT_MESSAGE =
    "Dismissing this collapses it to the notification bell; click the bell to re-expand.";
