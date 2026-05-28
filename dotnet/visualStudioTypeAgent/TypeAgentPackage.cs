// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#nullable enable

using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.TypeAgent.VisualStudio.Bridge;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Task = System.Threading.Tasks.Task;

namespace Microsoft.TypeAgent.VisualStudio;

[PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
[InstalledProductRegistration("TypeAgent Chat", "Chat-driven Visual Studio assistant", "0.1.0")]
[ProvideMenuResource("Menus.ctmenu", 1)]
[ProvideToolWindow(typeof(ChatToolWindow), Style = VsDockStyle.Tabbed)]
[Guid(PackageGuidString)]
public sealed class TypeAgentPackage : AsyncPackage
{
    public const string PackageGuidString = "b1a20f8c-7c53-4e2f-9c19-9f1e2a3d5f01";

    private AgentBridgeClient? _bridge;

    protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        await ChatToolWindowCommand.InitializeAsync(this);

        // Start the action bridge on the main thread so DTE calls don't marshal across.
        _bridge = new AgentBridgeClient(this);
        _ = _bridge.StartAsync(cancellationToken);
    }

    // Declare async tool window support so VSSDK003 is satisfied and VS can
    // construct ChatToolWindow off the UI thread.
    public override IVsAsyncToolWindowFactory? GetAsyncToolWindowFactory(Guid toolWindowType)
    {
        return toolWindowType == typeof(ChatToolWindow).GUID ? this : null;
    }

    protected override string GetToolWindowTitle(Type toolWindowType, int id)
    {
        return toolWindowType == typeof(ChatToolWindow)
            ? "TypeAgent Chat"
            : base.GetToolWindowTitle(toolWindowType, id);
    }

    protected override System.Threading.Tasks.Task<object?> InitializeToolWindowAsync(Type toolWindowType, int id, CancellationToken cancellationToken)
    {
        return System.Threading.Tasks.Task.FromResult<object?>(null);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _bridge?.Dispose();
            _bridge = null;
        }
        base.Dispose(disposing);
    }
}
