// Copyright (c) Microsoft. All rights reserved.

namespace TypeAgent.Email;

public sealed class Program
{
    static void Main(string[] args)
    {
        string path = @"C:\data\testEmail\Weekly T&R Security Compliance Status Report (September 30) .msg";
        Email email = null;
        using(Outlook outlook = new Outlook())
        {
            email = outlook.LoadEmail(path);
        }
        COMObject.ReleaseAll();
        if (email != null)
        {
            var json = email.ToJson();
            Console.WriteLine(json);
            Email saved = Json.Parse<Email>(json);
            Console.WriteLine(saved.ToString());
        }
    }
}
