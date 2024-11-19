FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable


FROM base AS build
COPY ./ /usr/src/app
WORKDIR /usr/src/app
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build
RUN pnpm deploy --filter=agent-api --prod /prod/api
#RUN pnpm deploy --filter=cli --prod /prod/cli


# COPY pnpm*.yaml /app/
# COPY packages/api/package.json /app/
# COPY packages/api /app/
# WORKDIR /app

# FROM base AS prod-deps
# RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --no-frozen-lockfile

# FROM base AS build
# RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile
# RUN pnpm run build

FROM base AS api
COPY --from=build /prod/api /prod/api
WORKDIR /prod/api

#COPY ../shell/out/renderer /app/wwwroot
#COPY --from=prod-deps /app/node_modules /app/node_modules
#COPY --from=build /app/dist /app/dist

EXPOSE 3000
EXPOSE 3443
EXPOSE 3030
EXPOSE 3734
CMD [ "pnpm", "start" ]