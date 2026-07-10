// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

// A package is a TypeAgent app agent when it exposes the agent manifest export
// (`"./agent/manifest"`); that is the same marker the installed-record provider
// resolves to load an agent. Such packages must declare the `typeagent-agent`
// keyword so feed enumeration can reliably discover installable agents
// (design §4.1, §12 Q12).
const AGENT_KEYWORD = "typeagent-agent";
const AGENT_MANIFEST_EXPORT = "./agent/manifest";
const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PROVIDER_CONFIG_DIR = "packages/defaultAgentProvider/data";
const PROVIDER_CONFIG_FILES = [
    "config.json",
    "config.all.json",
    "config.agent.json",
    "config.service.json",
    "config.test.json",
];

let defaultAgentNamesByPackageName;

function isAgentPackage(json) {
    const exports = json.exports;
    return (
        typeof exports === "object" &&
        exports !== null &&
        exports[AGENT_MANIFEST_EXPORT] !== undefined
    );
}

function getConfiguredDefaultAgentNames(repo) {
    if (defaultAgentNamesByPackageName !== undefined) {
        return defaultAgentNamesByPackageName;
    }
    defaultAgentNamesByPackageName = new Map();
    for (const configFile of PROVIDER_CONFIG_FILES) {
        const configPath = path.join(repo, PROVIDER_CONFIG_DIR, configFile);
        if (!fs.existsSync(configPath)) {
            continue;
        }
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        for (const [agentName, agentConfig] of Object.entries(
            config.agents ?? {},
        )) {
            if (typeof agentConfig.name !== "string") {
                continue;
            }
            let names = defaultAgentNamesByPackageName.get(agentConfig.name);
            if (names === undefined) {
                names = new Set();
                defaultAgentNamesByPackageName.set(agentConfig.name, names);
            }
            names.add(agentName);
        }
    }
    return defaultAgentNamesByPackageName;
}

function getConfiguredDefaultAgentName(file) {
    const packageName = file.json.name;
    if (typeof packageName !== "string") {
        return undefined;
    }
    const names = getConfiguredDefaultAgentNames(file.repo).get(packageName);
    return names?.size === 1 ? [...names][0] : undefined;
}

function getDeclaredDefaultAgentName(json) {
    const typeagent = json.typeagent;
    if (typeof typeagent !== "object" || typeagent === null) {
        return undefined;
    }
    return typeagent.defaultAgentName;
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
    {
        name: "agent-default-name",
        match: /package\.json$/i,
        check: (file) => {
            if (!isAgentPackage(file.json)) {
                return true;
            }

            const declaredName = getDeclaredDefaultAgentName(file.json);
            const expectedName = getConfiguredDefaultAgentName(file);
            if (
                typeof declaredName === "string" &&
                AGENT_NAME_RE.test(declaredName) &&
                (expectedName === undefined || declaredName === expectedName)
            ) {
                return true;
            }

            if (typeof declaredName !== "string") {
                return "agent package must declare typeagent.defaultAgentName in package.json";
            }
            if (!AGENT_NAME_RE.test(declaredName)) {
                return `agent package typeagent.defaultAgentName '${declaredName}' is not a legal agent name`;
            }
            return `agent package typeagent.defaultAgentName should be '${expectedName}'. Found '${declaredName}' instead.`;
        },
    },
];
