import * as P from '/home/claude/FalePDF/js/tools/imgproc.js';
const w=400,h=300; const d=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4; const shade = 255 - x*0.4; const text = (y%20<3 && x>50&&x<350)?0:1; const v = text? shade: 30; d[i]=v;d[i+1]=v;d[i+2]=v;d[i+3]=255;}
const img={data:d,width:w,height:h};
const t0=Date.now();
for (const op of ['sharpen','removeShadows','denoise','enhance','reduceMoire']) { const r = await P.OPS[op](img,{}); console.log(op, JSON.stringify(P.stats(r)), Date.now()-t0); }
console.log('orig', JSON.stringify(P.stats(img)));
const r = await P.look(img,{id:'vintage'}); console.log('vintage', P.stats(r).mean);
const m = P.floodMask(img, [[10,10]], {tolerance: 20}); console.log('mask', m.reduce((a,b)=>a+b,0));
