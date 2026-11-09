# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm AS runtime-base

# Refresh security updates and install only the dependencies needed at runtime.
# Azure CLI and development headers are deliberately excluded from this stage.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libsecret-1-0 \
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

# Install Chrome for Puppeteer.
RUN curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
    && rm /tmp/google-chrome.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists

# Build-only image. Azure CLI and pnpm are not copied into the runtime image.
FROM runtime-base AS build

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

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsecret-1-dev \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc -o /tmp/microsoft.asc \
    && gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg /tmp/microsoft.asc \
    && chmod 644 /etc/apt/keyrings/microsoft.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ bookworm main" > /etc/apt/sources.list.d/azure-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends azure-cli=2.91.0-1~bookworm \
    && rm /tmp/microsoft.asc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists

COPY ./ /usr/src/app
# onnxruntime-node's postinstall otherwise downloads the large CUDA/GPU
# onnxruntime build from GitHub releases. This image is CPU-only (no CUDA
# runtime) and that download is flaky in CI (fails with ECONNRESET), so skip
# it - the bundled CPU execution provider is all this container uses.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm run -r build
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm deploy --legacy --filter=agent-api --prod /prod/api

# Image with API bits only.
FROM runtime-base AS api

COPY --from=build /prod/api/ /prod/api/
COPY --from=build /usr/src/app/packages/shell/out/ /prod/shell/out/
COPY packages/api/container/start.sh /usr/local/bin/typeagent-api-start
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
ENV TYPEAGENT_API_BOOTSTRAP=hosted-azure-managed-identity-v1
ENV TYPEAGENT_API_CONFIG_SECRET=typeagent-api-hosted-config
ENV HOME=/home/typeagent
ENV TYPEAGENT_USER_DATA_DIR=/home/typeagent/.typeagent

# Browser clients are still gated on Origin, and a hosted deployment serves the
# chat view from its own hostname rather than localhost. Set
# TYPEAGENT_API_ALLOWED_ORIGINS to that public origin when running this image,
# e.g. TYPEAGENT_API_ALLOWED_ORIGINS=https://typeagent.example.com, or the
# browser's dispatcher WebSocket will be refused with 403.

RUN groupadd --gid 10001 typeagent \
    && useradd --uid 10001 --gid typeagent --no-create-home \
        --shell /usr/sbin/nologin typeagent \
    && install -d -o root -g root -m 0555 /home/typeagent \
    && install -d -o typeagent -g typeagent -m 0700 /home/typeagent/.typeagent \
    && chmod 0555 /usr/local/bin/typeagent-api-start

USER typeagent
CMD ["/usr/local/bin/typeagent-api-start"]

FROM api AS api-smoke
COPY packages/api/container/smoke.mjs /prod/api/container/smoke.mjs
CMD ["node", "/prod/api/container/smoke.mjs"]

# Keep production as the final stage because the ACR deployment builds this
# Dockerfile without an explicit --target.
FROM api AS production
