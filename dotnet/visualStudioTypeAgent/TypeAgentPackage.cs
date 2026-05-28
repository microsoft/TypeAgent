// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.TypeAgent.VisualStudio.Bridge;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

namespace Microsoft.TypeAgent.VisualStudio
{
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
}
