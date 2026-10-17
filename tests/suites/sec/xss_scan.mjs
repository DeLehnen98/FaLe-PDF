// Static scan: template literals that look like HTML; report interpolations that are not obviously safe.
import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/x.js');
const acorn = require('acorn'); const walk = require('acorn-walk');
import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2] || '/home/claude/FalePDF/js';
const SAFE_CALLS = new Set((process.env.SAFE || 'esc,icon,escAttr,escapeHtml,formatSize,formatDate,pagesLabel,fmtNum,Number,Math.round,String(Number').split(','));
const files = []; (function rec(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) rec(p); else if (p.endsWith('.js')) files.push(p); } })(ROOT);
let total = 0;
function calleeName(c) { if (c.type === 'Identifier') return c.name; if (c.type === 'MemberExpression') return (calleeName(c.object) || '?') + '.' + (c.property.name || '?'); return null; }
function safe(e, src) {
  switch (e.type) {
    case 'Literal': return true;
    case 'TemplateLiteral': return true; // analysed on its own
    case 'ConditionalExpression': return safe(e.consequent, src) && safe(e.alternate, src);
    case 'LogicalExpression': return safe(e.left, src) && safe(e.right, src);
    case 'BinaryExpression': return ['+', '-', '*', '/', '%'].includes(e.operator) ? (e.operator !== '+' || (safe(e.left, src) && safe(e.right, src))) : true;
    case 'UnaryExpression': return true;
    case 'CallExpression': {
      const n = calleeName(e.callee) || '';
      const last = n.split('.').pop();
      if (SAFE_CALLS.has(n) || SAFE_CALLS.has(last) || /icon$/i.test(last) || ['proBadge','today','t','tr','escapeXml','xmlEsc','escXml','attr','num','fmt','round','pct','px','clamp','parseInt','parseFloat','toISOString','encodeURIComponent'].includes(last)) return true;
      if (['toFixed', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].includes(last)) return true;
      if (last === 'join' && e.callee.object && e.callee.object.type === 'CallExpression') { const m = e.callee.object; const mn = calleeName(m.callee) || ''; if (mn.endsWith('.map')) { const fn = m.arguments[0]; if (fn && (fn.type === 'ArrowFunctionExpression') && fn.body.type === 'TemplateLiteral') return true; } }
      return false;
    }
    default: return false;
  }
}
const out = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let ast; try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); } catch (e) { console.error('PARSE', f, e.message); continue; }
  walk.full(ast, n => {
    if (n.type !== 'TemplateLiteral' || !n.expressions.length) return;
    const raw = n.quasis.map(q => q.value.raw).join('');
    if (!/<[a-zA-Z\/!]/.test(raw)) return;
    n.expressions.forEach((e, i) => {
      if (safe(e, src)) return;
      const before = n.quasis[i].value.raw.slice(-40).replace(/\s+/g, ' ');
      out.push(`${path.relative(ROOT, f)}:${e.loc.start.line}: ${src.slice(e.start, e.end).slice(0, 110).replace(/\s+/g, ' ')}   «…${before}»`);
      total++;
    });
  });
}
console.log(out.join('\n')); console.error('TOTAL', total);
