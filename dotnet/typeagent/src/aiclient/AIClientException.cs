// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class AIClientException : TypeAgentException<AIClientException.ErrorCode>
{
    public enum ErrorCode
    {
        InvalidEmbeddingResponse
    }

    public AIClientException(ErrorCode error)
        : base(error)
    {

    }
}
