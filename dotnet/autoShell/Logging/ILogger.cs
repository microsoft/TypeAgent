// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;

namespace autoShell.Logging;

/// <summary>
/// Provides logging methods for error, warning, and debug messages.
/// </summary>
internal interface ILogger
{
    /// <summary>
    /// Logs an exception as an error with colored console output.
    /// </summary>
    /// <param name="ex">The exception to log.</param>
    void Error(Exception ex);

    /// <summary>
    /// Logs a warning message with colored console output.
    /// </summary>
    /// <param name="message">The warning message.</param>
    void Warning(string message);

    /// <summary>
    /// Logs a debug/trace message to diagnostics output only.
    /// </summary>
    /// <param name="message">The debug message.</param>
    void Debug(string message);
}
