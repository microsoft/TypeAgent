// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export * from "./types.mjs";
export * from "./yamlParser.mjs";
export * from "./minimalParser.mjs";
export * from "./converter.mjs";
export * from "./artifactsStorage.mjs";
export * from "./schemaGenerator.mjs";

import { MacroConverter } from "./converter.mjs";
import { StoredMacro } from "../../storage/types.mjs";
import { ArtifactsStorage } from "./artifactsStorage.mjs";
import { YAMLMacroParser } from "./yamlParser.mjs";
import { YAMLMacro } from "./types.mjs";
import { Storage } from "@typeagent/agent-sdk";

export class YAMLMacroManager {
    private parser: YAMLMacroParser;
    private converter: MacroConverter;
    private artifactsStorage: ArtifactsStorage;

    constructor(macrosBasePath: string, sessionStorage?: Storage) {
        this.parser = new YAMLMacroParser();
        this.artifactsStorage = new ArtifactsStorage(
            macrosBasePath,
            sessionStorage,
        );
        this.converter = new MacroConverter(this.artifactsStorage);
    }

    parseYAML(yamlContent: string): YAMLMacro {
        return this.parser.parse(yamlContent);
    }

    stringifyYAML(yamlMacro: YAMLMacro): string {
        return this.parser.stringify(yamlMacro);
    }

    async convertYAMLToJSON(
        yamlMacro: YAMLMacro,
        macroId: string,
    ): Promise<StoredMacro> {
        return this.converter.convertYAMLToJSON(yamlMacro, macroId);
    }

    async convertJSONToYAML(
        jsonMacro: StoredMacro,
    ): Promise<{ yaml: YAMLMacro; recordingId?: string }> {
        return this.converter.convertJSONToYAML(jsonMacro);
    }

    async saveArtifacts(
        recordingId: string,
        artifacts: {
            screenshots: string[];
            recording: any[];
            url: string;
        },
    ): Promise<void> {
        return this.artifactsStorage.saveArtifacts(recordingId, artifacts);
    }

    async loadArtifacts(recordingId: string): Promise<{
        screenshot: string[];
        steps: any[];
    }> {
        return this.artifactsStorage.loadArtifacts(recordingId);
    }
}
