// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, TypeChatJsonTranslator, error } from "typechat";
import registerDebug from "debug";

type CorrectionRecord = {
    data: any;
    correction: ValidationError;
};

type TypeChatAgentSuccess<ResultType> = {
    success: true;
    data: ResultType;
    corrections?: CorrectionRecord[];
};

type TypeChatAgentError = {
    success: false;
    message: string;
    corrections?: CorrectionRecord[];
};

export type TypeChatAgentResult<T extends object = object> =
    | TypeChatAgentSuccess<T>
    | TypeChatAgentError;

const debugAgent = registerDebug("typeagent:typechatagent:correction");

export type ValidationError = string | string[];

export type TypeChatAgentValidator<
    InputType,
    ResultType extends object,
    ConfigType,
> = (
    input: InputType,
    result: ResultType,
    config?: ConfigType,
) => ValidationError | undefined;

export interface GenericTypeChatAgent<
    InputType,
    ResultType extends object,
    ConfigType,
> {
    run(
        input: InputType,
        config?: ConfigType,
    ): Promise<TypeChatAgentResult<ResultType>>;
    validate?:
        | TypeChatAgentValidator<InputType, ResultType, ConfigType>
        | undefined;
    correct?(
        input: InputType,
        result: ResultType,
        correction: ValidationError,
    ): Promise<TypeChatAgentResult<ResultType>>;
}

// TODO: probably most (all?) of these can be integrated into TypeChat
export class TypeChatAgent<InputType, ResultType extends object, ConfigType>
    implements GenericTypeChatAgent<InputType, ResultType, ConfigType>
{
    private static readonly defaultCorrectionAttempt = 3;
    constructor(
        private readonly resultName: string,
        private readonly createTranslator: () => TypeChatJsonTranslator<ResultType>,
        private readonly createPromptPreamble: (
            input: InputType,
        ) => string | PromptSection[],
        private readonly createRequest: (input: InputType) => string,
        public readonly validate?: TypeChatAgentValidator<
            InputType,
            ResultType,
            ConfigType
        >,
        private readonly correctionAttempt: number = TypeChatAgent.defaultCorrectionAttempt,
    ) {}

    private _translator: TypeChatJsonTranslator<ResultType> | undefined;

    private get translator() {
        if (this._translator === undefined) {
            this._translator = this.createTranslator();
            this._translator.stripNulls = true;
        }
        return this._translator;
    }

    public async run(
        input: InputType,
        config?: ConfigType,
    ): Promise<TypeChatAgentResult<ResultType>> {
        const promptPreamble = this.createPromptPreamble(input);
        let result: TypeChatAgentResult<ResultType> =
            await this.translator.translate(
                this.createRequest(input),
                promptPreamble,
            );

        let attempt = 0;
        const corrections: CorrectionRecord[] = [];

        while (result.success) {
            if (!this.validate) {
                break;
            }
            let error: ValidationError | undefined;
            let message: string | undefined;
            try {
                error = this.validate(input, result.data, config);
            } catch (e: any) {
                message = e.message;
                error = e.message;
            }
            if (error === undefined) {
                break;
            }
            corrections.push({ data: result.data, correction: error });
            if (message !== undefined || attempt >= this.correctionAttempt) {
                return {
                    success: false,
                    message:
                        message ??
                        `${this.resultName} error: correction failed after ${attempt} attempts`,
                    corrections,
                };
            }

            attempt++;
            debugAgent(
                `Attempting to correct ${this.resultName} (${attempt}): \n  ${
                    Array.isArray(error) ? `${error.join("\n  ")}` : error
                }`,
            );
            result = await this.correct(
                input,
                result.data,
                error,
                promptPreamble,
            );
        }

        if (corrections.length > 0) {
            result.corrections = corrections;
        }

        return result;
    }

    private createCorrectionPrompt(correction: ValidationError) {
        return (
            `The ${this.resultName} is incorrect for the following reason${
                Array.isArray(correction) && correction.length > 1 ? "s" : ""
            }:\n` +
            `"""\n${
                Array.isArray(correction) ? correction.join("\n") : correction
            }\n"""\n` +
            `The following is the revised result:\n`
        );
    }

    private toPromptSections(
        prompt: string | PromptSection[] | undefined,
    ): PromptSection[] {
        return typeof prompt === "string"
            ? [{ role: "user", content: prompt }]
            : prompt ?? [];
    }

    async followUp(
        request: string,
        result: ResultType,
        followUpPrompt: string | PromptSection[],
        promptPreamble?: string | PromptSection[],
    ) {
        const preamble: PromptSection[] = this.toPromptSections(promptPreamble);
        const followUpPromptSections: PromptSection[] =
            this.toPromptSections(followUpPrompt);
        const prompt: PromptSection[] = [
            ...preamble,
            {
                role: "user",
                content: this.translator.createRequestPrompt(request),
            },
            {
                role: "assistant",
                content: JSON.stringify(result, undefined, 2),
            },
            ...followUpPromptSections,
        ];
        return this.completeAndValidate(prompt);
    }

    stripNulls(obj: any) {
        let keysToDelete: string[] | undefined;
        for (const k in obj) {
            const value = obj[k];
            if (value === null) {
                (keysToDelete ??= []).push(k);
            } else {
                if (Array.isArray(value)) {
                    if (value.some((x) => x === null)) {
                        obj[k] = value.filter((x) => x !== null);
                    }
                }
                if (typeof value === "object") {
                    this.stripNulls(value);
                }
            }
        }
        if (keysToDelete) {
            for (const k of keysToDelete) {
                delete obj[k];
            }
        }
    }

    async completeAndValidate(prompt: PromptSection[]) {
        let attemptRepair = this.translator.attemptRepair;
        while (true) {
            const response = await this.translator.model.complete(prompt);
            if (!response.success) {
                return response;
            }
            const responseText = response.data;
            const startIndex = responseText.indexOf("{");
            const endIndex = responseText.lastIndexOf("}");
            if (!(startIndex >= 0 && endIndex > startIndex)) {
                return error(`Response is not JSON:\n${responseText}`);
            }
            const jsonText = responseText.slice(startIndex, endIndex + 1);
            let jsonObject;
            try {
                jsonObject = JSON.parse(jsonText) as object;
            } catch (e) {
                return error(
                    e instanceof SyntaxError ? e.message : "JSON parse error",
                );
            }
            if (this.translator.stripNulls) {
                this.stripNulls(jsonObject);
            }
            const schemaValidation =
                this.translator.validator.validate(jsonObject);
            const validation = schemaValidation.success
                ? this.translator.validateInstance(schemaValidation.data)
                : schemaValidation;
            if (validation.success) {
                return validation;
            }
            if (!attemptRepair) {
                return error(
                    `JSON validation failed: ${validation.message}\n${jsonText}`,
                );
            }
            prompt.push({ role: "assistant", content: responseText });
            prompt.push({
                role: "user",
                content: this.translator.createRepairPrompt(validation.message),
            });
            attemptRepair = false;
        }
    }

    public async correct(
        input: InputType,
        result: ResultType,
        correction: ValidationError,
        promptPreamble?: string | PromptSection[],
    ) {
        return this.followUp(
            this.createRequest(input),
            result,
            this.createCorrectionPrompt(correction),
            promptPreamble ?? this.createPromptPreamble(input),
        );
    }
}

export class SequentialTypeChatAgents<
    InputType,
    IntermediateType extends object,
    ResultType extends object,
    ConfigType,
> implements
        GenericTypeChatAgent<
            InputType,
            [IntermediateType, ResultType],
            ConfigType
        >
{
    constructor(
        private readonly agent1: TypeChatAgent<
            InputType,
            IntermediateType,
            ConfigType
        >,
        private readonly agent2: TypeChatAgent<
            [InputType, IntermediateType],
            ResultType,
            ConfigType
        >,
    ) {}
    async run(
        input: InputType,
        config?: ConfigType,
    ): Promise<TypeChatAgentResult<[IntermediateType, ResultType]>> {
        const result1 = await this.agent1.run(input, config);
        if (!result1.success) {
            return result1;
        }
        const result2 = await this.agent2.run([input, result1.data], config);
        if (result2.corrections) {
            // includes the data from agent1 in corrections
            result2.corrections.forEach((correction) => {
                correction.data = [result1.data, correction.data];
            });
        }
        if (!result2.success) {
            return result2;
        }
        const corrections: CorrectionRecord[] = [];
        if (result1.corrections) {
            corrections.push(...result1.corrections);
        }
        if (result2.corrections) {
            corrections.push(...result2.corrections);
        }
        const result: TypeChatAgentResult<[IntermediateType, ResultType]> = {
            success: true,
            data: [result1.data, result2.data],
        };
        if (corrections.length !== 0) {
            result.corrections = corrections;
        }
        return result;
    }

    public validate(
        input: InputType,
        result: [IntermediateType, ResultType],
        config?: ConfigType,
    ): ValidationError | undefined {
        const error1 = this.agent1.validate?.(input, result[0], config);
        if (error1 !== undefined) {
            return error1;
        }
        const error2 = this.agent2.validate?.(
            [input, result[0]],
            result[1],
            config,
        );
        if (error2 !== undefined) {
            return error2;
        }

        return undefined;
    }
}
