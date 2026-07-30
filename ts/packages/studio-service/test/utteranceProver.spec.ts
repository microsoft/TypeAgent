// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createUtteranceProver,
    selectExamplePhrase,
    type PhrasesReader,
    type UtteranceTranslate,
    type UtteranceTranslateOutcome,
} from "../src/onboarding/utteranceProver.js";

/** A PhrasesReader that returns a fixed map for every integration. */
function phrases(map: Record<string, string[]>): PhrasesReader {
    return async () => map;
}

/** A translator that records the utterances it saw and replies from a script. */
function recordingTranslate(
    script: (utterance: string) => UtteranceTranslateOutcome,
): { translate: UtteranceTranslate; seen: string[] } {
    const seen: string[] = [];
    const translate: UtteranceTranslate = async (utterance) => {
        seen.push(utterance);
        return script(utterance);
    };
    return { translate, seen };
}

describe("selectExamplePhrase", () => {
    it("returns the first non-empty phrase for a named action", () => {
        const selected = selectExamplePhrase(
            { setTemperature: ["  ", "set it to 68"], getStatus: ["status?"] },
            "setTemperature",
        );
        expect(selected).toEqual({
            utterance: "set it to 68",
            action: "setTemperature",
        });
    });

    it("visits actions in sorted order when no action is given", () => {
        const selected = selectExamplePhrase({
            setTemperature: ["set it to 68"],
            getStatus: ["status?"],
        });
        // "getStatus" sorts before "setTemperature".
        expect(selected).toEqual({ utterance: "status?", action: "getStatus" });
    });

    it("skips actions whose phrases are all blank", () => {
        const selected = selectExamplePhrase({
            aaa: ["   ", ""],
            bbb: ["real phrase"],
        });
        expect(selected).toEqual({ utterance: "real phrase", action: "bbb" });
    });

    it("returns undefined when there is no usable phrase", () => {
        expect(selectExamplePhrase({ a: [], b: ["  "] })).toBeUndefined();
    });
});

describe("createUtteranceProver", () => {
    it("reports answered + matched when the resolved action equals the phrase's action", async () => {
        const { translate, seen } = recordingTranslate(() => ({
            actions: [
                { schemaName: "thermostat", actionName: "setTemperature" },
            ],
        }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: phrases({ setTemperature: ["set living room to 68"] }),
        });

        const result = await prove("thermostat");

        expect(seen).toEqual(["set living room to 68"]);
        expect(result).toMatchObject({
            integrationName: "thermostat",
            utterance: "set living room to 68",
            expectedAction: "setTemperature",
            answered: true,
            resolvedSchema: "thermostat",
            resolvedAction: "setTemperature",
            matchedExpectedAction: true,
        });
    });

    it("answered but not matched when the agent resolves to a different action", async () => {
        const { translate } = recordingTranslate(() => ({
            actions: [{ schemaName: "thermostat", actionName: "getStatus" }],
        }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: phrases({ setTemperature: ["set living room to 68"] }),
        });

        const result = await prove("thermostat");

        expect(result.answered).toBe(true);
        expect(result.resolvedAction).toBe("getStatus");
        expect(result.matchedExpectedAction).toBe(false);
    });

    it("uses an explicit utterance and honors expectedAction without reading phrases", async () => {
        const { translate, seen } = recordingTranslate(() => ({
            actions: [
                { schemaName: "thermostat", actionName: "setTemperature" },
            ],
        }));
        let readCount = 0;
        const readPhrases: PhrasesReader = async () => {
            readCount++;
            return {};
        };
        const prove = createUtteranceProver({ translate, readPhrases });

        const result = await prove("thermostat", {
            utterance: "make it warmer",
            expectedAction: "setTemperature",
        });

        expect(readCount).toBe(0);
        expect(seen).toEqual(["make it warmer"]);
        expect(result.matchedExpectedAction).toBe(true);
    });

    it("restricts phrase selection to the requested expectedAction", async () => {
        const { translate, seen } = recordingTranslate(() => ({
            actions: [{ schemaName: "thermostat", actionName: "getStatus" }],
        }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: phrases({
                setTemperature: ["set it to 68"],
                getStatus: ["what's the temperature?"],
            }),
        });

        const result = await prove("thermostat", {
            expectedAction: "getStatus",
        });

        expect(seen).toEqual(["what's the temperature?"]);
        expect(result.matchedExpectedAction).toBe(true);
    });

    it("reports not answered (with the error) when the translator clarifies/cancels", async () => {
        const { translate } = recordingTranslate(() => ({
            actions: [],
            error: "Command was cancelled",
        }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: phrases({ setTemperature: ["set living room to 68"] }),
        });

        const result = await prove("thermostat");

        expect(result.answered).toBe(false);
        expect(result.matchedExpectedAction).toBe(false);
        expect(result.error).toBe("Command was cancelled");
    });

    it("treats a bare 'unknown' action as not answered", async () => {
        const { translate } = recordingTranslate(() => ({
            actions: [{ actionName: "unknown" }],
        }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: phrases({ setTemperature: ["set living room to 68"] }),
        });

        expect((await prove("thermostat")).answered).toBe(false);
    });

    it("does not count a system-schema resolution when agentSchemaNames is given", async () => {
        const { translate } = recordingTranslate(() => ({
            actions: [{ schemaName: "dispatcher", actionName: "clarify" }],
        }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: phrases({ setTemperature: ["set living room to 68"] }),
        });

        const result = await prove("thermostat", {
            agentSchemaNames: ["thermostat"],
        });

        expect(result.answered).toBe(false);
    });

    it("counts a resolution whose schema is in agentSchemaNames", async () => {
        const { translate } = recordingTranslate(() => ({
            actions: [
                { schemaName: "thermostat", actionName: "setTemperature" },
            ],
        }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: phrases({ setTemperature: ["set living room to 68"] }),
        });

        const result = await prove("thermostat", {
            agentSchemaNames: ["thermostat"],
        });

        expect(result.answered).toBe(true);
        expect(result.matchedExpectedAction).toBe(true);
    });

    it("throws an actionable error when no phrases exist", async () => {
        const { translate } = recordingTranslate(() => ({ actions: [] }));
        const prove = createUtteranceProver({
            translate,
            readPhrases: async () => undefined,
        });

        await expect(prove("thermostat")).rejects.toThrow(
            /No example phrases found for "thermostat"/,
        );
    });
});
