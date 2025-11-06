// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class KnowProException : TypeAgentException<KnowProException.ErrorCode>
{
    public enum ErrorCode
    {
        None = 0,
        DeserializeIsNull,
        InvalidKnowledgeType,
        InvalidKnowledgeTypeMismatch,
        KnowledgeTypeMismatch,
        StorageProviderDataNotFound,
        EmptyContext,
        EmptyPrompt
    }

    public KnowProException(ErrorCode errorCode)
        : base(errorCode)
    {
    }

    public KnowProException(ErrorCode errorCode, string message)
        : base(errorCode, message)
    {
    }
}
