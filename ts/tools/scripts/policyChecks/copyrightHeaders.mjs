// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const slashHeader = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.`;

const hashHeader = `# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.`;

const htmlHeader = `<!-- Copyright (c) Microsoft Corporation.
 Licensed under the MIT License. -->`;

const cmdHeader = `:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.`;

function checkCopyrightHeader(file, header, fix, skipFirstLineWithPrefix) {
    let firstLine = "";
    let content = file.content;
    if (skipFirstLineWithPrefix && skipFirstLineWithPrefix.test(content)) {
        const index = content.indexOf("\n");
        if (index !== -1) {
            firstLine = content.slice(0, index + 1);
            content = content.slice(index + 1);
        }
    }
    if (content.startsWith(header)) {
        return true;
    }
    if (fix) {
        file.content = `${firstLine}${header}\n\n${content}`;
        return false;
    }
    return "Header is missing";
}

const hashBang = /^#!/;

export const rules = [
    {
        name: "ts-js-copyright-header",
        match: /.*\.[cm]?[jt]sx?$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, slashHeader, fix, hashBang);
        },
    },
    {
        name: "cs-copyright-header",
        match: /.*\.cs$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, slashHeader, fix);
        },
    },
    {
        name: "less-copyright-header",
        match: /.*\.less$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, slashHeader, fix);
        },
    },
    {
        name: "py-copyright-header",
        match: /.*\.py$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, hashHeader, fix, hashBang);
        },
    },
    {
        name: "yaml-copyright-header",
        match: /.*\.ya?ml$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, hashHeader, fix);
        },
    },
    {
        name: "html-copyright-header",
        match: /.*\.html?$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, htmlHeader, fix, /^\<\!DOCTYPE/i);
        },
    },
    {
        name: "batch-copyright-header",
        match: /.*\.(cmd|bat)$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, cmdHeader, fix);
        },
    },
    {
        name: "shellscript-copyright-header",
        match: /.*\.(sh)$/i,
        check: (file, fix) => {
            return checkCopyrightHeader(file, hashHeader, fix, hashBang);
        },
    },
];
