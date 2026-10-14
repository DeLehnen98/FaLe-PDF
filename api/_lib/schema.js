'use strict';
// Minimal JSON-schema subset for validating model output the client will parse.
// Supported: type (object|array|string|integer|number|boolean), properties, required,
// additionalProperties:false (extra keys are dropped), items, minItems, maxItems,
// minLength, maxLength, minimum, maximum, enum.
//
// normalize() first makes harmless fixes (trim strings, cut over-long strings and arrays,
// numeric strings → numbers, drop unknown keys); validate() then checks the result strictly.

function normalize(schema, v) {
  if (v === null || v === undefined) return v;
  switch (schema.type) {
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) return v;
      const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      const out = {};
      for (const [k, sub] of Object.entries(schema.properties || {})) if (own(v, k)) out[k] = normalize(sub, v[k]);
      // model output is untrusted: never copy prototype-changing keys
      if (schema.additionalProperties !== false) for (const k of Object.keys(v)) if (!own(out, k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = v[k];
      return out;
    }
    case 'array': {
      if (!Array.isArray(v)) return v;
      let a = v.map(x => normalize(schema.items || {}, x)).filter(x => x !== null && x !== undefined && x !== '');
      if (schema.maxItems != null && a.length > schema.maxItems) a = a.slice(0, schema.maxItems);
      return a;
    }
    case 'string': {
      if (typeof v === 'number') v = String(v);
      if (typeof v !== 'string') return v;
      let s = v.replace(/\r\n?/g, '\n').trim();
      if (schema.maxLength != null && s.length > schema.maxLength) s = s.slice(0, schema.maxLength - 1).trimEnd() + '…';
      return s;
    }
    case 'integer':
    case 'number': {
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v.trim());
      if (schema.type === 'integer' && typeof v === 'number' && Number.isFinite(v)) v = Math.round(v);
      return v;
    }
    default: return v;
  }
}

function validate(schema, v, path = '$') {
  const errs = [];
  const err = m => errs.push(`${path}: ${m}`);
  switch (schema.type) {
    case 'object':
      if (!v || typeof v !== 'object' || Array.isArray(v)) { err('object erwartet'); break; }
      for (const r of schema.required || []) if (v[r] === undefined || v[r] === null) err(`${r} fehlt`);
      for (const [k, sub] of Object.entries(schema.properties || {})) if (v[k] !== undefined && v[k] !== null) errs.push(...validate(sub, v[k], `${path}.${k}`));
      if (schema.additionalProperties === false) for (const k of Object.keys(v)) if (!(schema.properties || {})[k]) err(`unerwartet: ${k}`);
      break;
    case 'array':
      if (!Array.isArray(v)) { err('array erwartet'); break; }
      if (schema.minItems != null && v.length < schema.minItems) err(`mindestens ${schema.minItems} Einträge`);
      if (schema.maxItems != null && v.length > schema.maxItems) err(`höchstens ${schema.maxItems} Einträge`);
      v.forEach((x, i) => errs.push(...validate(schema.items || {}, x, `${path}[${i}]`)));
      break;
    case 'string':
      if (typeof v !== 'string') { err('string erwartet'); break; }
      if (schema.minLength != null && v.length < schema.minLength) err('zu kurz');
      if (schema.maxLength != null && v.length > schema.maxLength) err('zu lang');
      if (schema.enum && !schema.enum.includes(v)) err('ungültiger Wert');
      break;
    case 'integer':
      if (!Number.isInteger(v)) { err('integer erwartet'); break; }
      if (schema.minimum != null && v < schema.minimum) err('zu klein');
      if (schema.maximum != null && v > schema.maximum) err('zu groß');
      break;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) { err('number erwartet'); break; }
      if (schema.minimum != null && v < schema.minimum) err('zu klein');
      if (schema.maximum != null && v > schema.maximum) err('zu groß');
      break;
    case 'boolean':
      if (typeof v !== 'boolean') err('boolean erwartet');
      break;
    default: break;
  }
  return errs;
}

/** Extract the first JSON object from model text (tolerates ```json fences and chatter). */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{');
  if (a < 0) return null;
  // scan for the matching closing brace (string-aware)
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { try { return JSON.parse(t.slice(a, i + 1)); } catch { return null; } } }
  }
  return null;
}

/** Compact, human-readable description of a schema for the prompt. */
function describe(schema, indent = '') {
  switch (schema.type) {
    case 'object': {
      const lines = Object.entries(schema.properties || {}).map(([k, s]) => `${indent}  "${k}"${(schema.required || []).includes(k) ? '' : ' (optional)'}: ${describe(s, indent + '  ').trimStart()}`);
      return `${indent}{\n${lines.join(',\n')}\n${indent}}`;
    }
    case 'array': return `${indent}[ ${describe(schema.items || {}, indent).trimStart()} ]${schema.minItems != null || schema.maxItems != null ? ` (${schema.minItems ?? 0}–${schema.maxItems ?? '∞'} Einträge)` : ''}`;
    case 'string': return `${indent}string${schema.maxLength ? ` (max. ${schema.maxLength} Zeichen)` : ''}${schema.enum ? ` (eins von: ${schema.enum.join(', ')})` : ''}`;
    case 'integer': return `${indent}integer${schema.minimum != null ? ` (${schema.minimum}–${schema.maximum})` : ''}`;
    default: return `${indent}${schema.type}`;
  }
}

module.exports = { normalize, validate, extractJson, describe };
