// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;

namespace autoShell.Logging;

/// <summary>
/// A no-op logger that discards all messages. Useful for tests and validation
/// where log output is not needed.
/// </summary>
internal class NullLogger : ILogger
{
    public void Error(Exception ex) { }
    public void Warning(string message) { }
    public void Info(string message) { }
    public void Debug(string message) { }
}
