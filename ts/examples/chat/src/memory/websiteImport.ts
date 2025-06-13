// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This file now re-exports from the standalone website-memory package
// instead of using the local implementation

import * as website from "website-memory";

// Re-export all types and functions from the website-memory package
export type ImportOptions = website.ImportOptions;
export type ChromeBookmark = any; // Keep for compatibility
export type ChromeBookmarkRoot = any; // Keep for compatibility
export type ChromeHistoryEntry = any; // Keep for compatibility
export type EdgeBookmark = any; // Keep for compatibility

// Main import function
export const importWebsites = website.importWebsites;

// Individual import functions for backward compatibility
export const importChromeBookmarks = website.importChromeBookmarks;
export const importChromeHistory = website.importChromeHistory;
export const importEdgeBookmarks = website.importEdgeBookmarks;
export const importEdgeHistory = website.importEdgeHistory;

// Utility functions
export const getDefaultBrowserPaths = website.getDefaultBrowserPaths;
export const determinePageType = website.determinePageType;
