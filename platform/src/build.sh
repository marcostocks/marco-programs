#!/bin/sh
# Concatenate src/parts/* into src/index.src.html, then embed the fonts and
# write the single-file site to index.html in the repo root.
#
#   sh src/build.sh
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
cat "$DIR"/parts/p1-head.html \
    "$DIR"/parts/p2-body.html \
    "$DIR"/parts/p3-data.js \
    "$DIR"/parts/p3b-chain.js \
    "$DIR"/parts/p4-markets.js \
    "$DIR"/parts/p5-trade.js \
    "$DIR"/parts/p6-preipo.js \
    "$DIR"/parts/p7-agents.js \
    "$DIR"/parts/p8-settings.js \
    "$DIR"/parts/p9-boot.html \
    "$DIR"/parts/p10-demo.html > "$DIR"/index.src.html
node "$DIR"/build-v2.js
