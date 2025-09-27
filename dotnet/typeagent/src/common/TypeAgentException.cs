// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public class TypeAgentException : Exception
{
    public TypeAgentException()
        : this("Unexpected error")
    {

    }

    public TypeAgentException(string message)
        : base(message)
    {
    }
}
