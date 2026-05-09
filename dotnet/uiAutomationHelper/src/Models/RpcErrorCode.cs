// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace UiAutomationHelper.Models;

internal enum RpcErrorCode
{
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
    ElementNotFound = -32001,
    ElementNotEnabled = -32002,
    PatternNotSupported = -32003,
    AppCrashed = -32004,
    Timeout = -32005,
    SnapshotPolicyInvalid = -32006,
    SnapshotMissing = -32007,
}
