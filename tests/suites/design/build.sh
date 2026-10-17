#!/bin/bash
set -e
D=/home/claude/FalePDF/tests/suites/design
rm -rf $D/src && mkdir -p $D/src
cd /home/claude/FalePDF && tar --exclude=./dist --exclude=./tests --exclude=./.git --exclude=./node_modules --exclude=./android -cf - . | (cd $D/src && tar -xf -)
cd $D/src && FALE_NODE_MODULES=/opt/npm-tools/node_modules node scripts/vercel-build.mjs | tail -1
find $D/serve -mindepth 1 -delete
cp -r $D/src/dist/. $D/serve/
