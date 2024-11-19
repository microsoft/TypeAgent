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
COPY --from=build /usr/src/app/.env /prod/api/
COPY --from=build /prod/api /prod/api
WORKDIR /prod/api

RUN apt-get update
RUN apt install -y gnome-keyring

#COPY ../shell/out/renderer /app/wwwroot
#COPY --from=prod-deps /app/node_modules /app/node_modules
#COPY --from=build /app/dist /app/dist

EXPOSE 3000
EXPOSE 3443
EXPOSE 3030
EXPOSE 3734
CMD [ "pnpm", "start" ]