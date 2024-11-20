FROM node:20 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable


FROM base AS build
COPY ./ /usr/src/app
WORKDIR /usr/src/app
#RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build
RUN pnpm deploy --filter=agent-api --prod /prod/api
#RUN pnpm deploy --filter=cli --prod /prod/cli

FROM base AS api
# environment file
COPY --from=build /usr/src/app/.env /prod/api/
# api bits
COPY --from=build /prod/api/ /prod/api/
# rendering bits
COPY --from=build /usr/src/app/packages/shell/out/ /prod/shell/out/
WORKDIR /prod/api

#dependencies
RUN apt-get update
RUN apt install -y gnome-keyring
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash

EXPOSE 80:3000
EXPOSE 8080:3000
EXPOSE 443:3443
EXPOSE 8083:3443
#CMD [ "pnpm", "start" ]

#azure login, then start node application
CMD [ "az", "login" ]