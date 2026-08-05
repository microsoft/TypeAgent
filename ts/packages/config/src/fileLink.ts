// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Links to local files inside chat messages.
 *
 * Plain `file:` URLs are stripped by the renderer's sanitizer (and are
 * inert in Electron / VS Code webviews anyway), so messages use a custom
 * `typeagent-file:` scheme instead. The chat hosts recognize it, turn it
 * back into a path and hand it to the OS ("open with the default editor").
 * The wire format is a `file:` URL with the scheme swapped, so encoding
 * of spaces, `#`, drive letters, ... is whatever `pathToFileURL` produces.
 */

import { pathToFileURL } from "node:url";

/** Scheme used for "open this local file" links in chat content. */
export const FILE_LINK_SCHEME = "typeagent-file:";

/**
 * The href for a local file link, or `undefined` when there is no path to
 * link to (callers then fall back to plain text).
 */
export function fileLinkHref(filePath: string | undefined): string | undefined {
    if (filePath === undefined || filePath === "") {
        return undefined;
    }
    return pathToFileURL(filePath).href.replace(/^file:/, FILE_LINK_SCHEME);
}
