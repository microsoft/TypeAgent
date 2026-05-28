// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Threading;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json.Linq;

namespace Microsoft.TypeAgent.VisualStudio;

public partial class ChatToolWindowControl : UserControl
{
    public ChatToolWindowControl()
    {
        InitializeComponent();
        Loaded += OnControlLoaded;
    }

    private void OnControlLoaded(object sender, System.Windows.RoutedEventArgs e)
    {
        // Hand the async work to the JTF and observe the JoinableTask via
        // FileAndForget so VSTHRD101/VSTHRD110 don't fire.
#pragma warning disable VSSDK007 // FileAndForget is the documented fire-and-forget observation for JoinableTask.
        ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
        {
            await InitializeWebViewAsync();
        }).FileAndForget("typeagent/vsix/webview-init");
#pragma warning restore VSSDK007
    }

    private async System.Threading.Tasks.Task InitializeWebViewAsync()
    {
        // User-data dir lives next to the extension assembly so multiple VS instances
        // share cookies/cache. Tweak if you need per-instance isolation.
        var userDataDir = Path.Combine(Path.GetTempPath(), "typeagent-vsix-webview");
        Directory.CreateDirectory(userDataDir);

        var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
        await ChatWebView.EnsureCoreWebView2Async(env);

        // Map the bundled WebView2 content to a virtual host so we can use
        // simple relative URLs and avoid the file:// CSP weirdness.
        var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!;
        var contentDir = Path.Combine(assemblyDir, "webview-content");
        ChatWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "typeagent.local",
            contentDir,
            CoreWebView2HostResourceAccessKind.Allow);

        // The WebView2 → host channel: chat-ui posts JSON for link clicks etc.
        ChatWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

        ChatWebView.CoreWebView2.Navigate("https://typeagent.local/index.html");
    }

    private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var root = JObject.Parse(e.WebMessageAsJson);
            switch (root.Value<string>("type"))
            {
                case "openExternal":
                    var url = root.Value<string>("url");
                    if (!string.IsNullOrWhiteSpace(url))
                    {
                        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                    }
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[TypeAgent] WebMessageReceived parse failed: {ex.Message}");
        }
    }
}
