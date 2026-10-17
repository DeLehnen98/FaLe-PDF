// Unit test for lib/qr-content.js: content types and the link check.  node tests/suites/webtools/qrcontent_unit.mjs
import { parseContent, checkLink, ibanValid, unicodeHost, siteOf, summaryOf, eanValid } from '../../../network/assets/wt/lib/qr-content.js';

let fail = 0, ok = 0;
const expect = (cond, msg) => { if (cond) ok++; else { fail++; console.log('FAIL', msg); } };

// links
const L = s => checkLink(s);
expect(L('https://www.fale.network/werkzeuge/').level === 'ok', 'plain https ok');
expect(L('https://www.fale.network/').site === 'fale.network', 'site');
expect(L('http://example.de/').level === 'warn', 'http warns');
expect(L('https://bank.de@evil.example/login').level === 'danger', 'userinfo is danger');
expect(L('https://bank.de@evil.example/login').notes[0].de.includes('evil.example'), 'userinfo names the real host');
expect(L('javascript:alert(1)').href === null && L('javascript:alert(1)').level === 'danger', 'javascript: never opens');
expect(L('data:text/html,<b>x</b>').href === null, 'data: never opens');
expect(L('https://192.168.0.1/admin').level === 'warn', 'ip warns');
expect(L('https://bit.ly/3abc').notes.some(n => /Kurz/.test(n.de)), 'shortener noted');
expect(L('https://xn--80ak6aa92e.com/').level !== 'ok', 'punycode flagged');
expect(unicodeHost('xn--80ak6aa92e.com') === 'аррӏе.com', `punycode decodes (${unicodeHost('xn--80ak6aa92e.com')})`);
expect(unicodeHost('xn--mnchen-3ya.de') === 'münchen.de', 'umlaut domain');
expect(L('https://xn--mnchen-3ya.de/').level === 'warn', 'umlaut domain is only a warning');
const mixed = L('https://xn--pple-43d.com/');   // "аpple" with Cyrillic а
expect(mixed.level === 'danger', `mixed script is danger (${mixed.display} ${mixed.level})`);
expect(L('https://example.com/app/update.apk').level === 'danger', 'apk download danger');
expect(L('https://paket-zustellung.example.top/x').level === 'warn', 'odd tld warns');
expect(L('https://login.sparkasse-konto.de.example.xyz/').notes.some(n => n.de.includes('beginnt wie')), 'domain-in-subdomain trick');
expect(L('https://login.example.de/').level === 'note', 'single bait label only a note');
expect(L('https://example.co.uk/').site === 'example.co.uk' && siteOf('a.b.example.co.uk') === 'example.co.uk', 'two-part suffix');
expect(L('https://example.de:8443/').notes.some(n => /Port/.test(n.de)), 'port noted');
expect(L('www.example.de').href === 'https://www.example.de/', 'www gets https');

// content types
const P = (s, f) => parseContent(s, f);
const w = P('WIFI:T:WPA;S:Café Netz;P:geh\\;eim123;H:true;;');
expect(w.type === 'wifi' && w.ssid === 'Café Netz' && w.password === 'geh;eim123' && w.hidden && w.security === 'WPA', `wifi ${JSON.stringify(w)}`);
expect(P('WIFI:S:Offen;T:nopass;;').security === 'nopass', 'open wifi');
const v = P('BEGIN:VCARD\nVERSION:3.0\nN:Mustermann;Erika;;;\nFN:Erika Mustermann\nORG:Muster GmbH;Vertrieb\nTEL;TYPE=CELL:+49 170 1234567\nTEL:+49 681 123\nEMAIL:erika@example.de\nADR:;;Hauptstr. 1;Saarbrücken;;66111;DE\nEND:VCARD');
expect(v.type === 'contact' && v.name === 'Erika Mustermann' && v.tel.length === 2 && v.org === 'Muster GmbH, Vertrieb' && v.adr[0].includes('Saarbrücken'), `vcard ${JSON.stringify(v)}`);
const me = P('MECARD:N:Mustermann,Erika;TEL:+49170;EMAIL:e@x.de;;');
expect(me.type === 'contact' && me.name === 'Erika Mustermann' && me.vcard.includes('FN:Erika Mustermann'), 'mecard → vcard');
const epc = P('BCD\n002\n1\nSCT\nBFSWDE33XXX\nFale Test e.V.\nDE89 3704 0044 0532 0130 00\nEUR12.50\n\nRF18539007547034\n\n');
expect(epc.type === 'payment' && epc.ibanOk && epc.amount === 12.5 && epc.currency === 'EUR' && epc.reference === 'RF18539007547034', `epc ${JSON.stringify(epc)}`);
expect(!ibanValid('DE89370400440532013001'), 'bad iban');
const ev = P('BEGIN:VEVENT\nSUMMARY:Treffen\nDTSTART:20261020T090000Z\nDTEND:20261020T100000Z\nLOCATION:Saal 2\nEND:VEVENT');
expect(ev.type === 'event' && ev.title === 'Treffen' && ev.start.date.toISOString() === '2026-10-20T09:00:00.000Z' && ev.ics.startsWith('BEGIN:VCALENDAR'), 'event');
const otp = P('otpauth://totp/Beispiel:erika@example.de?secret=JBSWY3DPEHPK3PXP&issuer=Beispiel');
expect(otp.type === 'otp' && otp.issuer === 'Beispiel' && otp.account === 'erika@example.de' && !JSON.stringify(otp).includes('JBSWY'), 'otp without secret');
expect(!summaryOf(otp).includes('JBSWY'), 'otp summary has no secret');
expect(P('mailto:info@example.de?subject=Hallo%20du').subject === 'Hallo du', 'mailto');
expect(P('MATMSG:TO:a@b.de;SUB:Hi;BODY:Text;;').to === 'a@b.de', 'matmsg');
expect(P('SMSTO:+49170123:Hallo Welt').body === 'Hallo Welt', 'smsto');
expect(P('sms:+49170123?body=Guten%20Tag').body === 'Guten Tag', 'sms body');
expect(P('tel:+49 681 123').number === '+49 681 123', 'tel');
const g = P('geo:49.2354,6.9969?q=Saarbr%C3%BCcken');
expect(g.type === 'geo' && g.lat === 49.2354 && g.label === 'Saarbrücken', 'geo');
expect(P('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.01').type === 'crypto', 'crypto');
expect(P('4006381333931', 'ean_13').type === 'product' && eanValid('4006381333931'), 'ean');
expect(!eanValid('4006381333932'), 'bad ean');
expect(P('Hallo Welt').type === 'text', 'text');
expect(P('https://example.de/x').type === 'link', 'link type');
expect(P('javascript:alert(1)').type === 'link' && P('javascript:alert(1)').href === null, 'js link');

console.log(`qr-content: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
