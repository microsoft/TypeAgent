// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
  docs: [
    {
      title: "Introduction",
      url: "/"
    },
    {
      title: "Getting Started",
      url: "/content/setup/setup-Windows/",
      children: [
        {
          title: "Linux",
          url: "/content/setup/setup-Linux/"
        }
        ,
        {
          title: "MacOS",
          url: "/content/setup/setup-MacOS/"
        }
        ,

        {
          title: "Windows",
          url: "/content/setup/setup-Windows/"
        },
        {
          title: "WSL",
          url: "/content/setup/setup-WSL2/"
        }
      ]
    },
    {
      title: "Architecture",
      url: "/content/architecture/memory/",
      children: [
        {
          title: "Memory",
          url: "/content/architecture/memory/"
        },
        {
          title: "Dispatcher",
          url: "/content/architecture/dispatcher/"
        }
      ]
    },
    {
      title: "Tutorials",
      url: "/content/tutorial/agent/",
      children: [
        {
          title: "Creating an Agent",
          url: "/content/tutorial/agent/"
        }
      ]
    }
  ]
};
