// Copyright (c) Microsoft. All rights reserved.

namespace TypeAgent.Email;

public class EmailAddress
{
    public EmailAddress()
    {
    }
    public EmailAddress(string address, string displayName = null)
    {
        Address = address;
        DisplayName = displayName;
    }

    public string Address { get; set; }
    public string DisplayName { get; set; }

    public override string ToString()
    {
        if (string.IsNullOrEmpty(DisplayName))
        {
            return Address ?? string.Empty;
        }
        else
        {
            return string.IsNullOrEmpty(Address) ? DisplayName : $"\"{DisplayName}\" <{Address}>";
        }
    }
}
