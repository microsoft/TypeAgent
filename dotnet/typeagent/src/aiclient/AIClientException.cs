// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class AIClientException : TypeAgentException<AIClientException.ErrorCode>
{
    public enum ErrorCode
    {
        MissingApiSetting,
        InvalidEmbeddingResponse
    }

    public AIClientException(ErrorCode error, string? message = null)
        : base(error, message)
    {
    }
}
