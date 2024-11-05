// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const copyrightText = "Copyright (c) Microsoft Corporation.";
const licenseText = "Licensed under the MIT License.";
const prefixHeader = (prefix) =>
    `${prefix} ${copyrightText}\n${prefix} ${licenseText}`;
const enclosedHeader = (prefix, suffix) =>
    `${prefix} ${copyrightText}\n ${licenseText} ${suffix}`;

const slashHeader = prefixHeader("//");
const hashHeader = prefixHeader("#");
const cmdHeader = prefixHeader("::");
const htmlHeader = enclosedHeader("<!--", "-->");

function checkExtraCopyRight(header, content) {
    const escaped = header.replaceAll(/([()\][{*+.$^\\|?])/g, "\\$1");
    const regexp = new RegExp(
        escaped.replace(
            "Microsoft Corporation",
            "Microsoft Corporation and .*",
        ),
        "my",
    );
    return regexp.test(content);
}

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
    if (content.startsWith(header) || checkExtraCopyRight(header, content)) {
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
