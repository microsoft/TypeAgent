FROM node:22 AS runtime-base

# Install runtime dependencies required by TypeAgent and Chrome/Puppeteer.
# Azure CLI is deliberately excluded from this stage so it cannot persist in
# the production image or leave a reusable account cache.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libsecret-1-0 \
    gnome-keyring \
    libxss1 \
    libgconf-2-4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libnss3-dev \
    libxss-dev \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libdbus-1-3 \
    libnspr4 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# Build-only image. Azure CLI remains available here for authenticated package
# feeds, but this stage is not shipped.
FROM runtime-base AS build
ARG PNPM_VERSION=11.9.0
RUN npm install --global "pnpm@${PNPM_VERSION}"
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libsecret-1-dev \
    && curl -sL https://aka.ms/InstallAzureCLIDeb | bash \
    && rm -rf /var/lib/apt/lists/*
COPY ./ /usr/src/app
WORKDIR /usr/src/app
# onnxruntime-node's postinstall otherwise downloads the large CUDA/GPU
# onnxruntime build from GitHub releases. This image is CPU-only (no CUDA
# runtime) and that download is flaky in CI (fails with ECONNRESET), so skip
# it — the bundled CPU execution provider is all this container uses.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build
RUN pnpm deploy --legacy --filter=agent-api --prod /prod/api

# Image with API bits only.
FROM runtime-base AS api
# api bits
COPY --from=build /prod/api/ /prod/api/
# rendering bits
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

EXPOSE 80:3000

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
