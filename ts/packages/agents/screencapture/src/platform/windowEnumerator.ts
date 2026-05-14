// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WindowInfo = {
    // Platform-specific identifier: pid on win32, X11 window id (hex) on linux.
    id: string;
    // Visible window title (e.g. "untitled - Notepad").
    title: string;
    // Underlying process name (e.g. "notepad", "code").
    processName: string;
};
