module.exports = {
  docs: [
    {
      title: "Introduction",
      url: "/"
    },
    {
      title: "Getting Started",
      url: "/content/getting-started/",
      children: [
        {
          title: "Windows",
          url: "/setup/setup-Windows/"
        },
        {
          title: "WSL",
          url: "/setup/setup-WSL2/"
        }
        ,
        {
          title: "Linux",
          url: "/setup/setup-Linux/"
        }
        ,
      ]
    },
    {
      title: "Architecture",
      children: [
        {
          title: "Memory",
          url: "/architecture/memory/"
        },
        {
          title: "Dispatcher",
          url: "/architecture/dispatcher/"
        }
      ]
    },
    {
      title: "Command Reference",
      url: "/help/commandReference/"
    },
    {
      title: "Tutorials",
      children: [
        {
          title: "Creating an Agent",
          url: "/tutorial/agent/"
        }
      ]
    }
  ]
};
