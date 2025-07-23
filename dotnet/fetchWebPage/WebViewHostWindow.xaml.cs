// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace ConsoleApp1;
/// <summary>
/// Interaction logic for Window1.xaml
/// </summary>
public partial class WebViewHostWindow : Window
{
    public WebViewHostWindow()
    {
        InitializeComponent();
    }

    private void WebView2_ContentLoading(object sender, Microsoft.Web.WebView2.Core.CoreWebView2ContentLoadingEventArgs e)
    {

    }

    private async void WebView2_NavigationCompleted(object sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
    {
        // make sure the navigated completed event is for the web page we are trying to download
        Debug.WriteLine(e);

        string html = await webView.CoreWebView2.ExecuteScriptAsync("document.documentElement.outerHTML");
        string decodedHtml = System.Text.Json.JsonSerializer.Deserialize<string>(html);

        Console.WriteLine(decodedHtml);
        //Application.Current.Shutdown();

        Program.dispatcher.InvokeShutdown();
    }
}
