# Agent Cache REST Endpoint

## Overview

This example shows how to host the AgentCache and serve HTTP rest calls to return cach hits/misses. This is **sample code**.

## Running

The server can be started with `npm run start` in this package's directory or launch it from the debug menu in VS code. Once it is up and running you can `http://localhost:10482` using a web browser to issue API calls.

## Populating the Cache

The cache file in [data/v5_sample.json](data/v5_sample.json) has the values _add eggs and milk to the grocery list_ and variations thereof. To populate your own cache quickly, you can use the [Shell](../../packages/shell/) with the following steps:

    1. Create a demo script containing the statements you want to cache.  See the [demos](../../packages/shell/demo/) folder for some example demo scripts.

    2. Open the shell and run the *@shell run* and then selecting the file from #1.

    3. Wait for all of the commands to run and get explained by the explainer (look for varations of the roadrunner icon in the user text).

    4. The location of the cache file from the shell can be determined by running *@const info* in the shell.

### Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
