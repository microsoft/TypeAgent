// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const state = {
    creates: 0,
    calls: [],
    disposes: 0,
    malformed: false,
    fail: false,
    gate: undefined,
    vectors: undefined,
    missingArtifactHash: false,
    missingMedia: false,
    adapterOptions: [],
};
export async function createAdapter(options) {
    const { revision } = options;
    ++state.creates;
    state.adapterOptions.push(options);
    return {
        metadata: { local_files_only: options.localFilesOnly ?? false },
        descriptor: {
            provider: "local",
            model: "synthetic",
            revision,
            dimensions: 2,
            query_prompt: "query: ",
            document_prompt: "document: ",
            pooling: "mean",
            normalization: "l2",
            preprocessing: "synthetic text and media",
            artifact_sha256: state.missingArtifactHash
                ? undefined
                : "a".repeat(64),
        },
        async embed(texts, role) {
            state.calls.push({ texts, role });
            await state.gate;
            if (state.fail) throw new Error("synthetic inference failure");
            return (
                state.vectors ??
                (state.malformed
                    ? []
                    : texts.map(() => (role === "query" ? [0, 1] : [1, 0])))
            );
        },
        embedMedia: state.missingMedia
            ? undefined
            : async (samples, role) => {
                  state.calls.push({ samples, role });
                  return samples.map(() => [1, 0]);
              },
        async dispose() {
            ++state.disposes;
        },
    };
}
