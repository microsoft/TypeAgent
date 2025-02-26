FROM node:20 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest
RUN corepack enable pnpm
RUN corepack install -g pnpm@latest

# dependencies
RUN apt-get update
RUN apt-get install -y libsecret-1-0
RUN apt-get install -y libsecret-1-dev
RUN apt install -y gnome-keyring
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash

# Install dependencies required for Chrome/Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
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

# Install Chrome for Puppeteer
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb

# base only image
FROM base AS build
COPY ./ /usr/src/app
WORKDIR /usr/src/app
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build
RUN pnpm deploy --filter=agent-api --prod /prod/api
RUN pnpm deploy --filter=tools-scripts --prod /prod/tools

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

EXPOSE 80:3000

# start actions
# az login
RUN echo az login --identity >> start.sh
## mount blob storage locally
#RUN echo blobfuse2 mount /mnt/blob --config-file=mount-blobfuse.yaml >> start.sh
# run getKeys
RUN echo node ../tools/scripts/getKeys.mjs >> start.sh
# start API server
RUN echo pnpm start >> start.sh

# run start script
CMD ["bash", "start.sh"]
