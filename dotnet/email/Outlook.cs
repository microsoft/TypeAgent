// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

    public List<Email> LoadFrom(string senderName, string? senderEmail = null)
    {
        Filter filter = new Filter("SenderName", senderName);
        if (!string.IsNullOrEmpty(senderEmail))
        {
            filter = filter.And("SenderEmailAddress", senderEmail);
        }
        return FilterItems(filter, (item) =>
        {
            if (item is MailItem mailItem)
            {
                return new Email(mailItem);
            }
            return null;
        });
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

    public List<T> FilterItems<T>(Filter filter, Func<object, T> gettor) where T : class
    {
        NameSpace ns = null;
        MAPIFolder inbox = null;
        Items items = null;
        Items filteredItems = null;
        try
        {
            ns = _outlook.GetNamespace("MAPI");
            inbox = ns.GetDefaultFolder(OlDefaultFolders.olFolderInbox);
            items = inbox.Items;
            filteredItems = items.Restrict(filter);
            List<T> typedItems = new List<T>();
            foreach (object item in filteredItems)
            {
                T itemT = gettor(item);
                if (itemT != null)
                {
                    typedItems.Add(itemT);
                }
            }
            return typedItems;
        }
        finally
        {
            COMObject.Release(filteredItems);
            COMObject.Release(items);
            COMObject.Release(inbox);
            COMObject.Release(ns);
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
