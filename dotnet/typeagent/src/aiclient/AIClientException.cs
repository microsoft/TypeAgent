// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class AIClientException : TypeAgentException<AIClientException.ErrorCode>
{
    public enum ErrorCode
    {
        MissingApiSetting,
        InvalidApiSetting,
        InvalidEmbeddingResponse,
        InvalidChatResponse
    }

    public AIClientException(ErrorCode error, string? message = null)
        : base(error, message)
    {
    }
}
