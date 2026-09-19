# TypeAgent HTTP API

## Overview

TypeAgent API is a HTTP+WS API server for **TypeAgent sample code**. It explores architectures for building distributed _interactive agents_ with _natural language interfaces_ using structured prompting and LLM. This interface shows developers one way of broadening the reach of Agents to web-enabled devices such as internet browsers, mobile phones, and IOT connected devices.

## Running

After setting up and building at the workspace root, there are several ways to start the server.

### Locally

The server can be started with `npm run start` in this package's directory. Then connect to `http://localhost:3000` using a web browser. If you want to load the Shell interface in the browser window you want to open `http://localhost:3000/chatView.html`

It binds loopback (`127.0.0.1`) so a local run isn't reachable from the network.
The server has no authentication: anything that can reach the port can dispatch
actions with your permissions - send mail from your account, read your files,
drive your browser. Set `host` in `data/config.json`, or `TYPEAGENT_API_HOST`
(which wins), to bind another address, and only do so behind a network boundary
you control.

The `/action/` endpoint and the dispatcher WebSocket also refuse requests that a
web page could have caused (checked via the `Origin` and `Sec-Fetch-Site`
headers), so a site the user visits can't drive the server through the browser.
A hosted deployment serves the chat view from its own hostname, so set
`TYPEAGENT_API_ALLOWED_ORIGINS` (comma separated, e.g.
`https://typeagent.example.com`) to the origins browsers will load it from -
otherwise only loopback origins are accepted and the browser client gets a 403.

Static files are served with `Access-Control-Allow-Origin` echoing the request's
origin, but only when that origin passes the same allowlist; every other request
gets no CORS header. The clients that need these files load them from the page
this server itself served, so they are same-origin and need no header. (This
previously went out as `*`, which let any site on the web read them.)

`/action/` accepts GET so simple clients such as IOT devices can submit an
action as a URL. That keeps one gap: the checks above identify a browser
request by its headers, and browsers released before fetch metadata support
(roughly Firefox 90 and Safari 16.4) send neither `Origin` nor
`Sec-Fetch-Site` on an image or script load. On those browsers a page the user
visits can still reach `/action/` on loopback with a tag like
`<img src="http://localhost:3000/action/?a=...">`, because a request with no
headers at all is indistinguishable from a non-browser client. Current
browsers label that request `cross-site` and it is refused. Use a current
browser, or drop GET support locally if you need to close this off entirely.

### Docker Image

It is possible to use the [docker image](../../Dockerfile) to host TypeAgent either locally or in a cloud hosted environment such as [Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/quickstart-custom-container?tabs=dotnet&pivots=container-linux-vscode). The image sets `TYPEAGENT_API_HOST=0.0.0.0` because the published port is the point there and the container is the isolation boundary. Set `TYPEAGENT_API_ALLOWED_ORIGINS` to the public origin the chat view is served from so browser clients pass the Origin gate.

### Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
