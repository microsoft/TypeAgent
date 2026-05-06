// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace UiAutomationHelper.Models;

internal sealed class RpcException : Exception
{
    public RpcErrorCode Code { get; }
    public object? ErrorData { get; }

    public RpcException(RpcErrorCode code, string message, object? data = null)
        : base(message)
    {
        Code = code;
        ErrorData = data;
    }
}
