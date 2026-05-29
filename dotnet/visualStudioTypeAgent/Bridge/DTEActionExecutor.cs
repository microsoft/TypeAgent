// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Newtonsoft.Json.Linq;

namespace Microsoft.TypeAgent.VisualStudio.Bridge;

/// <summary>
/// Dispatches incoming BridgeRequests to EnvDTE. Action names match the
/// schema in packages/agents/visualStudio/src/visualStudioSchema.ts.
///
/// All DTE access happens on the VS UI thread.
/// </summary>
internal sealed class DTEActionExecutor
{
    private readonly AsyncPackage _package;

    public DTEActionExecutor(AsyncPackage package)
    {
        _package = package;
    }

    public async Task<object?> ExecuteAsync(string actionName, JObject parameters, CancellationToken cancellation)
    {
        await _package.JoinableTaskFactory.SwitchToMainThreadAsync(cancellation);
        var dte = (DTE2?)await _package.GetServiceAsync(typeof(DTE));
        if (dte is null)
        {
            throw new InvalidOperationException("DTE service unavailable.");
        }

        return actionName switch
        {
            // ---- Files ----
            "openFile"  => OpenFile(dte, parameters),
            "saveAll"   => Exec(dte, "File.SaveAll"),
            "closeAll"  => CloseAll(dte, parameters),

            // ---- Edit ----
            "undo"      => Exec(dte, "Edit.Undo"),
            "redo"      => Exec(dte, "Edit.Redo"),
            "gotoLine"  => GotoLine(dte, parameters),
            "findText"  => FindText(dte, parameters),
            "findInFiles" => FindInFiles(dte, parameters),

            // ---- Build ----
            "build"     => Build(dte, parameters),
            "clean"     => Clean(dte, parameters),
            "run"       => Exec(dte, "Debug.StartWithoutDebugging"),

            // ---- Debug ----
            "debug"     => Exec(dte, "Debug.Start"),
            "go"        => DebuggerGo(dte),
            "break"     => DebuggerBreak(dte),
            "stop"      => Exec(dte, "Debug.StopDebugging"),
            "stepInto"  => Exec(dte, "Debug.StepInto"),
            "stepOver"  => Exec(dte, "Debug.StepOver"),
            "stepOut"   => Exec(dte, "Debug.StepOut"),
            "addBreakpoint" => AddBreakpoint(dte, parameters),
            "removeBreakpoint" => RemoveBreakpoint(dte, parameters),

            // ---- Catch-all ----
            "executeCommand" => ExecuteCommand(dte, parameters),

            _ => throw new NotSupportedException($"Unknown action '{actionName}'."),
        };
    }

    // ---- Helpers ----

    private static object? Exec(DTE2 dte, string command, string? args = null)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        dte.ExecuteCommand(command, args ?? string.Empty);
        return new { command };
    }

    private static string Required(JObject p, string name)
    {
        var v = p.Value<string>(name);
        if (string.IsNullOrEmpty(v))
        {
            throw new ArgumentException($"{name} is required");
        }
        return v!;
    }

    private static object? OpenFile(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var filePath = Required(p, "filePath");
        var viewKind = p.Value<string>("viewKind");
        var kind = viewKind switch
        {
            "code"     => EnvDTE.Constants.vsViewKindCode,
            "designer" => EnvDTE.Constants.vsViewKindDesigner,
            "debug"    => EnvDTE.Constants.vsViewKindDebugging,
            _          => EnvDTE.Constants.vsViewKindTextView,
        };
        dte.ItemOperations.OpenFile(filePath, kind);
        return new { opened = filePath };
    }

    private static object? CloseAll(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var saveChanges = p.Value<bool?>("saveChanges") ?? false;
        dte.ExecuteCommand("Window.CloseAllDocuments");
        // TODO: honor saveChanges=false properly (would need to iterate Documents and Close(vsSaveNo)).
        return new { closed = true, saved = saveChanges };
    }

    private static object? GotoLine(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var lineStr = Required(p, "line");
        if (!int.TryParse(lineStr, out var line))
        {
            throw new ArgumentException($"line '{lineStr}' is not a valid integer.");
        }
        var select = p.Value<bool?>("select") ?? false;

        var doc = dte.ActiveDocument;
        if (doc is null)
        {
            throw new InvalidOperationException("No active document.");
        }
        var sel = (TextSelection)doc.Selection;
        sel.GotoLine(line, select);
        return new { line, select };
    }

    private static object? FindText(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var text = Required(p, "text");
        dte.ExecuteCommand("Edit.Find", text);
        return new { searched = text };
    }

    private static object? FindInFiles(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var searchTerm = Required(p, "searchTerm");
        // TODO: drive dte.Find with FindReplaceKind=vsFindReplaceFindInFiles for headless results.
        dte.ExecuteCommand("Edit.FindinFiles", searchTerm);
        return new { searched = searchTerm };
    }

    private static object? Build(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var wait = p.Value<bool?>("waitForCompletion") ?? false;
        dte.Solution.SolutionBuild.Build(wait);
        return new { started = true, wait };
    }

    private static object? Clean(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var wait = p.Value<bool?>("waitForCompletion") ?? false;
        dte.Solution.SolutionBuild.Clean(wait);
        return new { started = true, wait };
    }

    private static object? DebuggerGo(DTE2 dte)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        dte.Debugger.Go(false);
        return new { state = dte.Debugger.CurrentMode.ToString() };
    }

    private static object? DebuggerBreak(DTE2 dte)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        dte.Debugger.Break(false);
        return new { state = dte.Debugger.CurrentMode.ToString() };
    }

    private static object? AddBreakpoint(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var file = Required(p, "file");
        var lineStr = Required(p, "line");
        if (!int.TryParse(lineStr, out var line))
        {
            throw new ArgumentException($"line '{lineStr}' is not a valid integer.");
        }
        var condition = p.Value<string>("condition");

        var bps = dte.Debugger.Breakpoints.Add("", file, line, 1, condition ?? "");
        return new { added = bps.Count, file, line };
    }

    private static object? RemoveBreakpoint(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var idStr = p.Value<string>("breakpointId");
        if (!string.IsNullOrEmpty(idStr))
        {
            foreach (Breakpoint bp in dte.Debugger.Breakpoints)
            {
                if (string.Equals(bp.Name, idStr, StringComparison.Ordinal))
                {
                    bp.Delete();
                    return new { removed = idStr };
                }
            }
            throw new InvalidOperationException($"No breakpoint with id '{idStr}'.");
        }

        var file = p.Value<string>("file");
        var lineStr = p.Value<string>("line");
        if (file is null || lineStr is null || !int.TryParse(lineStr, out var line))
        {
            throw new ArgumentException("Provide either {breakpointId} or {file, line}.");
        }

        int removed = 0;
        for (int i = dte.Debugger.Breakpoints.Count; i >= 1; i--)
        {
            var bp = dte.Debugger.Breakpoints.Item(i);
            if (string.Equals(bp.File, file, StringComparison.OrdinalIgnoreCase) && bp.FileLine == line)
            {
                bp.Delete();
                removed++;
            }
        }
        return new { removed };
    }

    private static object? ExecuteCommand(DTE2 dte, JObject p)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var commandName = Required(p, "commandName");
        var args = p.Value<string>("commandArgs");
        dte.ExecuteCommand(commandName, args ?? string.Empty);
        return new { executed = commandName };
    }
}
