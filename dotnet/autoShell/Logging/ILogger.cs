// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;

namespace autoShell.Logging;

/// <summary>
/// Provides logging methods for error, warning, info, and debug messages.
/// </summary>
internal interface ILogger
{
    /// <summary>
    /// Logs an exception as an error.
    /// </summary>
    /// <param name="ex">The exception to log.</param>
    void Error(Exception ex);

    /// <summary>
    /// Logs a warning message.
    /// </summary>
    /// <param name="message">The warning message.</param>
    void Warning(string message);

    /// <summary>
    /// Logs an informational message visible to the user.
    /// </summary>
    /// <param name="message">The info message.</param>
    void Info(string message);

    /// <summary>
    /// Logs a debug-level message.
    /// </summary>
    /// <param name="message">The debug message.</param>
    void Debug(string message);
}
