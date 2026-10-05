// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Daemon address and routes, shared by the server and its client. No
// imports, so the CLI can reach the daemon without loading the server.
// Example: POST http://127.0.0.1:51703/api/sessions

// Loopback only: the API reads the repository and has no authentication.
export const LOOPBACK_HOST = "127.0.0.1";

// Fixed so every client knows where the daemon listens. Chosen from the
// IANA dynamic range (49152-65535) to avoid registered services.
export const DAEMON_PORT = 51703;

// Identity route: `daemon status` checks the pid it returns.
export const DAEMON_ROUTE = "/api/daemon";

// Session registration route: Copilot `sessionStart` hook posts here.
export const SESSIONS_ROUTE = "/api/sessions";
