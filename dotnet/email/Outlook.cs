// Copyright (c) Microsoft. All rights reserved.
using TypeAgent.Core;

namespace TypeAgent;

public class Outlook : COMObject
{
    private Application _outlook;
    private NameSpace _session;

    public Outlook()
    {
        _outlook = new Application();
        _session = _outlook.Session;
    }

    public Email LoadEmail(string filePath)
    {
        Verify.FileExists(filePath);

        MailItem mail = (MailItem)_session.OpenSharedItem(filePath);
        try
        {
            return new Email(mail, filePath);
        }
        finally
        {
            COMObject.Release(mail);
            mail = null;
        }
    }

    protected override void OnDispose()
    {
        COMObject.Release(_session);
        COMObject.Release(_outlook);
        _session = null;
        _outlook = null;
    }
}
