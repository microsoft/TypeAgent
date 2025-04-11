// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function createFetchError(message: string, response: Response) {
    let responseData = "";
    try {
        responseData = `\n${await response.text()}`;
    } catch {
        // Ignore error
    }
    return new Error(
        `${message}: ${response.status} ${response.statusText}${responseData}`,
    );
}
