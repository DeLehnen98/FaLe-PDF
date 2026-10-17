import { makeVectors, checkJava } from '/home/claude/FalePDF/scripts/android-one-e2e/crossvec.mjs';
const vec = await makeVectors();
// fake a Java answer that is wrong in subtle ways
const out = { 'check.a':'ok','check.b':'ok','check.c':'ok','check.d':'ok','check.e':'ok','check.f':'ok','check.g':'ok','check.h':'ok','check.i':'FAIL x', 'j.nodeId': vec.nodeId, 'j.nodeWrapped': vec.nodeWrapped, 'j.nodeRaw': vec.fileRaw };
console.log(await checkJava(vec, out));
