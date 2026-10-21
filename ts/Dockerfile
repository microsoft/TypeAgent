# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /usr/src/app
COPY package.json ./package.json
# npm honors private-registry credentials; Corepack does not read .npmrc.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm install --global corepack@0.36.0 \
    && corepack disable pnpm \
    && npm install --global "$(node -p "require('./package.json').packageManager.split('+')[0]")" \
    && npm cache clean --force

# Refresh security updates as well as installing the app's system dependencies.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libsecret-1-0 \
    libsecret-1-dev \
    gnome-keyring \
    curl \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libnss3-dev \
    libxss-dev \
    fonts-liberation \
    libasound2 \
    libdbus-1-3 \
    libnspr4 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists

RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc -o /tmp/microsoft.asc \
    && gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg /tmp/microsoft.asc \
    && chmod 644 /etc/apt/keyrings/microsoft.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ bookworm main" > /etc/apt/sources.list.d/azure-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends azure-cli=2.91.0-1~bookworm \
    && rm /tmp/microsoft.asc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists

# Install Chrome for Puppeteer
RUN curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
    && rm /tmp/google-chrome.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists

# base only image
FROM base AS build
COPY ./ /usr/src/app
WORKDIR /usr/src/app
# onnxruntime-node's postinstall otherwise downloads the large CUDA/GPU
# onnxruntime build from GitHub releases. This image is CPU-only (no CUDA
# runtime) and that download is flaky in CI (fails with ECONNRESET), so skip
# it — the bundled CPU execution provider is all this container uses.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm run -r build
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm deploy --legacy --filter=agent-api --prod /prod/api
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm deploy --legacy --filter=tools-scripts --prod /prod/tools

# image with api and tool bits only 
FROM base AS api
# api bits
COPY --from=build /prod/api/ /prod/api/
COPY --from=build /prod/tools/ /prod/tools/
# rendering bits
COPY --from=build /usr/src/app/packages/shell/out/ /prod/shell/out/
WORKDIR /prod/api

######################################### BLOB STORAGE MOUNT ######################################### 
## blobfuse - https://github.com/Azure/azure-storage-fuse/tree/main
## Uncomment the section below to use blobfuse to mount blob storage
#RUN apt-get update \
#    && apt-get install -y wget apt-utils \
#    && wget https://packages.microsoft.com/config/ubuntu/20.04/packages-microsoft-prod.deb \
#    && dpkg -i packages-microsoft-prod.deb \
#    && apt-get update \
#    && apt-get install -y libfuse3-dev fuse3 libcurl3-gnutls libgnutls30
#
#RUN apt-get install -y blobfuse2
#COPY --from=build /usr/src/app/mount-blobfuse.yaml ./mount-blobfuse.yaml
#RUN mkdir /mnt/blob
#RUN mkdir /blob-cache
######################################################################################################

EXPOSE 3000

# The API server binds loopback by default so a local run isn't reachable from
# the network. In the container the published port is the whole point and the
# container boundary is the isolation, so bind all interfaces here.
ENV TYPEAGENT_API_HOST=0.0.0.0

# Browser clients are still gated on Origin, and a hosted deployment serves the
# chat view from its own hostname rather than localhost. Set
# TYPEAGENT_API_ALLOWED_ORIGINS to that public origin when running this image,
# e.g. TYPEAGENT_API_ALLOWED_ORIGINS=https://typeagent.example.com, or the
# browser's dispatcher WebSocket will be refused with 403.

# start actions
# az login
RUN echo az login --identity >> start.sh
## mount blob storage locally
#RUN echo blobfuse2 mount /mnt/blob --config-file=mount-blobfuse.yaml >> start.sh
# run getKeys
RUN echo node ../tools/scripts/getKeys.mjs >> start.sh
# Start Node directly so startup does not need npm registry credentials.
RUN echo node ./dist/index.js >> start.sh

# run start script
CMD ["bash", "start.sh"]
