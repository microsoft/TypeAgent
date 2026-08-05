// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Local-file links in chat content.
 *
 * Messages link to files on the user's machine with a `typeagent-file:`
 * URL (produced by `@typeagent/config`'s `fileLinkHref`) because `file:`
 * hrefs are sanitized away and are inert in Electron / webview hosts.
 * Hosts get the click through `PlatformAdapter.handleLinkClick` and use
 * this helper to recover the path before handing it to the OS.
 */

/** Scheme used for "open this local file" links in chat content. */
export const FILE_LINK_SCHEME = "typeagent-file:";

/** True when the href is a local-file link. */
export function isFileLink(href: string): boolean {
    return href.startsWith(FILE_LINK_SCHEME);
}

/**
 * The filesystem path a `typeagent-file:` link points at, or `undefined`
 * for any other href. Mirrors Node's `fileURLToPath` for the cases the
 * link generator can produce (including Windows drive letters and UNC
 * paths), without pulling in a Node dependency.
 */
export function fileLinkToPath(href: string): string | undefined {
    if (!isFileLink(href)) {
        return undefined;
    }
    let url: URL;
    try {
        url = new URL(`file:${href.slice(FILE_LINK_SCHEME.length)}`);
    } catch {
        return undefined;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) {
        // UNC: file://server/share/file -> \\server\share\file
        return `\\\\${url.hostname}${pathname.replace(/\//g, "\\")}`;
    }
    // Windows drive letters arrive as "/C:/dir/file".
    return /^\/[a-zA-Z]:/.test(pathname)
        ? pathname.slice(1).replace(/\//g, "\\")
        : pathname;
}
