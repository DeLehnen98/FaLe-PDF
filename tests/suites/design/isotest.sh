#!/bin/bash
D=/home/claude/FalePDF/tests/suites/design
python3 $D/iso.py > /dev/null
cd $D/iso && FALE_NODE_MODULES=/opt/npm-tools/node_modules node scripts/vercel-build.mjs | tail -1
find $D/testserve -mindepth 1 -delete; cp -r $D/iso/dist/. $D/testserve/
cd $D/tests && ./runall.sh
