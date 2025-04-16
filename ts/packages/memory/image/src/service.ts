// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This script starts an indexing service


/**
 * Indicate to the host/parent process that we've started successfully
 */
process.send?.("Success");

/**
 * Processes messages received from the host/parent process
 */
process.on("message", (message: any) => {
    console.log(message);
});

/**
 * Closes this process at the request of the host/parent process
 */
process.on("disconnect", () => {
    process.exit(1);
});

console.log("Indexing service started successfully.");