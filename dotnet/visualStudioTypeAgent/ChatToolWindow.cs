// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace Microsoft.TypeAgent.VisualStudio;

[Guid("d3b40faa-9d75-4f4f-be3b-bf3f4c5f7023")]
public class ChatToolWindow : ToolWindowPane
{
    public ChatToolWindow() : base(null)
    {
        Caption = "TypeAgent Chat";
        Content = new ChatToolWindowControl();
    }
}
