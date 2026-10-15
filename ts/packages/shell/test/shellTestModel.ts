// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getShellTestModel(): string | undefined {
    const value = process.env.TYPEAGENT_SHELL_TEST_MODEL;
    if (value === undefined) return undefined;
    const model = value.trim();
    if (!model)
        throw new Error(
            "TYPEAGENT_SHELL_TEST_MODEL must name a configured model",
        );
    return model;
}

export async function configureShellTestModel(
    sendRequest: (request: string) => Promise<string>,
): Promise<void> {
    const model = getShellTestModel();
    if (model === undefined) return;
    for (const kind of ["translation", "explainer"] as const) {
        const response = await sendRequest(`@config ${kind} model ${model}`);
        const expected = `Model for ${kind} is set to ${model}`;
        if (response !== expected)
            throw new Error(
                `Failed to configure shell test ${kind} model: expected '${expected}', received '${response}'`,
            );
    }
}
