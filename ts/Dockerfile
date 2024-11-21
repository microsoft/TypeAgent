FROM node:20 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable


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
# rendering bits
COPY --from=build /usr/src/app/packages/shell/out/ /prod/shell/out/
WORKDIR /prod/api

# dependencies
RUN apt-get update
RUN apt install -y gnome-keyring
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash

EXPOSE 80:3000

# setup start actions
RUN echo az login --identity >> start.sh
RUN echo node ../tools/scripts/getKeys.mjs >> start.sh
RUN echo pnpm start >> start.sh

# azure login, then start node application
CMD bash start.sh