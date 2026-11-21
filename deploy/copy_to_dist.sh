#!/usr/bin/env bash
# Copies Web A's static files into its directory of the build (`dev/build.ts`)

cp -R ./public/* ${1:-"dist/a"}

cp ./node_modules/opus-recorder/dist/decoderWorker.min.wasm ${1:-"dist/a"}

cp -R ./node_modules/emoji-data-ios/img-apple-64 ${1:-"dist/a"}
cp -R ./node_modules/emoji-data-ios/img-apple-160 ${1:-"dist/a"}
