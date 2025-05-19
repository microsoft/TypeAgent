module.exports = {
  docs: [
    {
      title: "Introduction",
      url: "/"
    },
    {
      title: "Getting Started",
      url: "/setup/setup-Windows/",
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
      url: "/architecture/memory/",
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
      title: "Tutorials",
      url: "/tutorial/agent/",
      children: [
        {
          title: "Creating an Agent",
          url: "/tutorial/agent/"
        }
      ]
    }
  ]
};
