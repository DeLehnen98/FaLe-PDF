// Unit checks of network/assets/wt/lib/bg-core.js (agent bg)
import * as C from '/home/claude/FalePDF/network/assets/wt/lib/bg-core.js';
import assert from 'node:assert/strict';
const w = 64, h = 48, n = w * h;
// box blur keeps constants and mean
const one = new Float32Array(n).fill(0.7); assert.ok(C.boxBlur(one, w, h, 5).every(v => Math.abs(v - 0.7) < 1e-5));
// a sharp square: coarse 16×12 mask + photo with the edge → guided upsampling snaps to the photo edge
const rgba = new Uint8ClampedArray(n * 4), gt = new Float32Array(n);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const fg = x >= 20 && x < 44 && y >= 12 && y < 36; gt[y * w + x] = fg; const v = fg ? 200 : 40; rgba.set([v, v, v, 255], (y * w + x) * 4); }
const coarse = C.resizeFloat(gt, w, h, 16, 12);
const m = C.upsampleMask(coarse, 16, 12, rgba, w, h);
const a = C.refineMask(m, 0, 0.6);
const iou = C.maskIoU(a, gt);
assert.ok(iou > 0.9, 'guided upsample IoU ' + iou);
assert.deepEqual(C.subjectBox(gt, w, h), { x: 20, y: 12, w: 24, h: 24 });
// shift: tighter edge → less foreground
const sum = x => x.reduce((s, v) => s + v, 0);
assert.ok(sum(C.refineMask(m, -50)) < sum(C.refineMask(m, 50)));
// edits: white keeps, black removes
const al = new Float32Array(2).fill(0.5); C.applyEdits(al, new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])); assert.deepEqual([...al], [1, 0]);
// model sizes
assert.deepEqual(C.inferSize(4000, 3000, 'u2net'), [320, 320]);
const [mw, mh] = C.inferSize(4000, 3000, 'modnet'); assert.ok(mw % 32 === 0 && mh === 512 && mw <= 1024);
console.log('bg units ok (guided IoU ' + iou.toFixed(3) + ')');
