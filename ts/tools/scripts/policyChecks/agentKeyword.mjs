// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// A package is a TypeAgent app agent when it exposes the agent manifest export
// (`"./agent/manifest"`); that is the same marker the installed-record provider
// resolves to load an agent.  Such packages must declare the `typeagent-agent`
// keyword so feed enumeration can reliably discover installable agents
// (design §4.1, §12 Q12).
const AGENT_KEYWORD = "typeagent-agent";
const AGENT_MANIFEST_EXPORT = "./agent/manifest";

function isAgentPackage(json) {
    const exports = json.exports;
    return (
        typeof exports === "object" &&
        exports !== null &&
        exports[AGENT_MANIFEST_EXPORT] !== undefined
    );
}

export const rules = [
    {
        name: "agent-keyword",
        match: /package\.json$/i,
        check: (file, fix) => {
            if (!isAgentPackage(file.json)) {
                return true;
            }
            const keywords = file.json.keywords;
            if (Array.isArray(keywords) && keywords.includes(AGENT_KEYWORD)) {
                return true;
            }
            if (fix) {
                file.json.keywords = Array.isArray(keywords)
                    ? [...new Set([...keywords, AGENT_KEYWORD])]
                    : [AGENT_KEYWORD];
                return false;
            }
            return `agent package must include '${AGENT_KEYWORD}' in package.json keywords`;
        },
    },
];
