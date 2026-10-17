// Minimal PostgreSQL client (simple query protocol, trust auth, unix socket) – test use only.
//   const c = await connect({ path: '/tmp/faleacct/.s.PGSQL.5544', user: 'postgres', database: 'fale_acct' });
//   const rows = await c.query("select 1 as x");     // → [{x:'1'}] (text values) ; throws PgError
//   lit(v) → SQL literal (string, number, boolean, null, object → jsonb text)
import net from 'node:net';

export class PgError extends Error {
  constructor(fields) { super(fields.M || 'pg error'); this.code = fields.C; this.detail = fields.D; this.fields = fields; }
}

export function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('bad number'); return String(v); }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') v = JSON.stringify(v);
  return "'" + String(v).replace(/\u0000/g, '').replace(/'/g, "''") + "'";
}

export function connect({ path, user = 'postgres', database = 'postgres' }) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(path);
    let buf = Buffer.alloc(0);
    let waiter = null; // {resolve, reject, rows, fields, err, multi}
    let ready = false;
    const queue = [];
    const startup = () => {
      const params = Buffer.from(`user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`);
      const len = Buffer.alloc(8); len.writeInt32BE(8 + params.length, 0); len.writeInt32BE(196608, 4);
      sock.write(Buffer.concat([len, params]));
    };
    sock.on('connect', startup);
    sock.on('error', e => { if (!ready) reject(e); else if (waiter) waiter.reject(e); });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 5) {
        const type = String.fromCharCode(buf[0]);
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) break;
        const body = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);
        handle(type, body);
      }
    });
    function parseFields(body) {
      const f = {}; let i = 0;
      while (i < body.length && body[i] !== 0) { const code = String.fromCharCode(body[i]); i++; const end = body.indexOf(0, i); f[code] = body.toString('utf8', i, end); i = end + 1; }
      return f;
    }
    function handle(type, body) {
      if (type === 'R') { const k = body.readInt32BE(0); if (k !== 0) reject(new Error('auth method ' + k + ' not supported')); return; }
      if (type === 'E') { const f = parseFields(body); if (!ready) { reject(new PgError(f)); return; } if (waiter) waiter.err = waiter.err || new PgError(f); return; }
      if (type === 'Z') {
        if (!ready) { ready = true; resolve(api); return; }
        const w = waiter; waiter = null;
        if (w) { if (w.err) w.reject(w.err); else w.resolve(w.rows); }
        next();
        return;
      }
      if (type === 'T') {
        const n = body.readInt16BE(0); let i = 2; const fields = [];
        for (let k = 0; k < n; k++) { const end = body.indexOf(0, i); fields.push(body.toString('utf8', i, end)); i = end + 1 + 18; }
        if (waiter) { waiter.fields = fields; waiter.rows = []; }
        return;
      }
      if (type === 'D') {
        const n = body.readInt16BE(0); let i = 2; const row = {};
        for (let k = 0; k < n; k++) {
          const l = body.readInt32BE(i); i += 4;
          const v = l < 0 ? null : body.toString('utf8', i, i + l); if (l > 0) i += l;
          row[waiter.fields[k]] = v;
        }
        waiter.rows.push(row);
        return;
      }
      // 'C' CommandComplete, 'S' ParameterStatus, 'K' BackendKeyData, 'N' Notice, 'I' EmptyQuery: ignore
    }
    function next() {
      if (waiter || !queue.length) return;
      waiter = queue.shift();
      waiter.rows = [];
      const q = Buffer.from(waiter.sql + '\0', 'utf8');
      const head = Buffer.alloc(5); head[0] = 0x51; head.writeInt32BE(4 + q.length, 1);
      sock.write(Buffer.concat([head, q]));
    }
    const api = {
      query(sql) { return new Promise((res, rej) => { queue.push({ sql, resolve: res, reject: rej }); next(); }); },
      close() { try { sock.end(Buffer.from([0x58, 0, 0, 0, 4])); } catch {} },
    };
  });
}

/** A small pool (n connections, round robin on idle) so concurrent HTTP requests don't serialize completely. */
export async function pool(opts, n = 4) {
  const conns = await Promise.all(Array.from({ length: n }, () => connect(opts)));
  const busy = conns.map(() => Promise.resolve());
  let rr = 0;
  return {
    /** run(fn(conn)) exclusively on one connection */
    run(fn) {
      const i = rr++ % n;
      const p = busy[i].then(() => fn(conns[i]));
      busy[i] = p.catch(() => {});
      return p;
    },
    close() { conns.forEach(c => c.close()); },
  };
}
