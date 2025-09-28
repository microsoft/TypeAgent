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

public class TypeAgentException<TError> : Exception
{
    public TypeAgentException(TError error)
        : this(error, null, null)
    {
    }

    public TypeAgentException(TError error, Exception innerEx)
        : this(error, null, innerEx)
    {
    }

    public TypeAgentException(TError error, string message)
        : this(error, message, null)
    {
    }

    public TypeAgentException(TError error, string message, Exception innerEx)
           : base(MakeMessage(error, message), innerEx)
    {
        Error = error;
    }

    public TError Error { get; private set; }

    private static string MakeMessage(TError error, string message)
    {
        if (message != null)
        {
            return string.Format("{0}\n{1}", error, message);
        }

        return error.ToString();
    }
}
