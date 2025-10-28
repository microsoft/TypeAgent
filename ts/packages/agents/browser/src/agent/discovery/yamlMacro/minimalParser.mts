// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import yaml from "yaml";
import { MinimalYAMLMacro } from "./types.mjs";

export class MinimalYAMLParser {
    parse(yamlString: string): MinimalYAMLMacro {
        const parsed = yaml.parse(yamlString) as any;

        if (!parsed || typeof parsed !== "object") {
            throw new Error("Invalid YAML: expected object");
        }

        if (!parsed.name || typeof parsed.name !== "string") {
            throw new Error("Invalid YAML: missing or invalid 'name' field");
        }

        if (!parsed.domain || typeof parsed.domain !== "string") {
            throw new Error("Invalid YAML: missing or invalid 'domain' field");
        }

        if (!parsed.url || typeof parsed.url !== "string") {
            throw new Error("Invalid YAML: missing or invalid 'url' field");
        }

        if (!Array.isArray(parsed.steps)) {
            throw new Error("Invalid YAML: missing or invalid 'steps' field");
        }

        return {
            name: parsed.name,
            description: parsed.description || "",
            domain: parsed.domain,
            url: parsed.url,
            parameters: parsed.parameters || {},
            steps: parsed.steps,
        };
    }

    stringify(macro: MinimalYAMLMacro): string {
        return yaml.stringify(macro, {
            indent: 2,
            lineWidth: -1,
        });
    }
}
