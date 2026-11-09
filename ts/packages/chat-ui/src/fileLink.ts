// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Local-file links in chat content.
 *
 * Messages link to files on the user's machine with a `typeagent-file:`
 * URL (produced by `@typeagent/config`'s `fileLinkHref`) because `file:`
 * hrefs are sanitized away and are inert in Electron / webview hosts.
 * Hosts get the click through `PlatformAdapter.handleLinkClick` and use
 * this helper to recover a local path. The host must still compare it with
 * its allowlisted config path before opening it.
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
 * link generator can produce, without pulling in a Node dependency. UNC paths
 * are rejected because following a remote SMB path from message content can
 * trigger network authentication or execute a remote file.
 */
export function fileLinkToPath(href: string): string | undefined {
    if (!isFileLink(href)) {
        return undefined;
    }
    const encodedPath = href.slice(FILE_LINK_SCHEME.length);
    if (
        /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(encodedPath) ||
        /%2e%2e(?:%2f|%5c|[\\/]|$)/i.test(encodedPath)
    ) {
        return undefined;
    }
    let url: URL;
    try {
        url = new URL(`file:${encodedPath}`);
    } catch {
        return undefined;
    }
    if (url.hostname) {
        return undefined;
    }
    let pathname: string;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return undefined;
    }
    if (
        pathname.split(/[\\/]/).some((segment) => segment === "..") ||
        pathname.includes("\0")
    ) {
        return undefined;
    }
    // Windows drive letters arrive as "/C:/dir/file".
    return /^\/[a-zA-Z]:/.test(pathname)
        ? pathname.slice(1).replace(/\//g, "\\")
        : pathname;
}
