// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The visual editor round-trips through Milkdown's serializer, which can
// change formatting. Raw HTML and images are excluded because Milkdown
// renders raw HTML nodes with innerHTML and image nodes load their URL, and
// imported content is untrusted.
export function canEditWysiwyg(markdown: string): boolean {
    return (
        !/<\/?[a-zA-Z][\w-]*(\s[^>]*)?\/?>/.test(markdown) &&
        !/!\[[^\]]*\]\(/.test(markdown)
    );
}
