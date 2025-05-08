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

    public List<Email> LoadFrom(EmailSender sender)
    {
        Filter filter = sender.ToFilter();
        return FilterItems(filter, (item) =>
        {
            return item is MailItem mailItem ? new Email(mailItem) : null;
        });
    }

    public List<Email> LoadEmail(string filePath)
    {
        Verify.FileExists(filePath);

        MailItem mail = (MailItem)_session.OpenSharedItem(filePath);
        List<Email> emails = new List<Email>();
        try
        {
            if (mail.IsForward())
            {
                string mailText = mail.ToText();
                string[] emailBodies = BodyParser.Default.SplitForwardedEmail(mailText);
                for (int i = 0; i < emailBodies.Length; ++i)
                {
                    try
                    {
                        emails.Add(Email.FromText(emailBodies[i]));
                    }
                    catch (System.Exception ex)
                    {
                        ConsoleEx.LogError(ex);
                    }
                }
            }
            else
            {
                emails.Add(new Email(mail, filePath));
            }
        }
        catch (System.Exception ex)
        {
            ConsoleEx.LogError(ex);
        }
        finally
        {
            COMObject.Release(mail);
            mail = null;
        }
        return emails;
    }

    public void SaveEmailAsText(string filePath, string savePath)
    {
        MailItem mail = (MailItem)_session.OpenSharedItem(filePath);
        try
        {
            mail.SaveAsText(savePath);
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

    public IEnumerable<T> MapMailItems<T>(Func<MailItem, T> mapFn, OlSensitivity sensitivity = OlSensitivity.olNormal)
    {
        return MapMailItems<T>(mapFn, null, sensitivity);
    }

    public IEnumerable<T> MapMailItems<T>(Func<MailItem, T> mapFn, Filter? filter, OlSensitivity sensitivity = OlSensitivity.olNormal)
    {
        foreach(MailItem item in ForEachMailItem(filter, sensitivity))
        {
            T result = mapFn(item);
            yield return result;
        }
    }

    public IEnumerable<MailItem> ForEachMailItem(OlSensitivity sensitivity = OlSensitivity.olNormal)
    {
        return ForEachMailItem(null, sensitivity);
    }

    public IEnumerable<MailItem> ForEachMailItem(Filter? filter, OlSensitivity sensitivity = OlSensitivity.olNormal)
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

            if (filter is not null)
            {
                filteredItems = items.Restrict(filter);
            }
            items.Sort("[ReceivedTime]", true);
            foreach (object item in filteredItems ?? items)
            {
                try
                {
                    if (item is MailItem mailItem &&
                        mailItem.HasBody() &&
                        mailItem.Sensitivity == sensitivity)
                    {
                        yield return mailItem;
                    }
                }
                finally
                {
                    COMObject.Release(item);
                }
            }
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
