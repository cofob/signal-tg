# syntax=docker/dockerfile:1
# The TeleSignal tunnel as a container image. `docker build proxy` compiles the tunnel from source. The release
# workflow builds the `prebuilt` stage from the static binaries it compiled, `bin/amd64` and `bin/arm64`, so that no
# compiler runs under emulation.

FROM rust:1.98.1-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM scratch AS base
# The tunnel must listen on the container's address; publish the port to loopback or a reverse proxy only
ENV HOST=0.0.0.0 PORT=8787 ALLOW_PUBLIC_BIND=1
EXPOSE 8787
USER 65532:65532
ENTRYPOINT ["/telesignal-tunnel"]

FROM base AS prebuilt
ARG TARGETARCH
COPY --chmod=755 bin/${TARGETARCH}/telesignal-tunnel /telesignal-tunnel

FROM base AS runtime
COPY --from=build --chmod=755 /src/target/release/telesignal-tunnel /telesignal-tunnel
