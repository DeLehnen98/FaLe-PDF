// Tool: protect PDFs with a password – AES-256 (PDF 2.0 standard security handler, V5/R6) via
// lib/shared/pdfcrypt.js. Open password with strength meter + generator, optional owner password and
// permissions, or "restrictions only". Passwords live only in this module's memory, never in the DOM
// longer than needed, never stored or sent anywhere.
import { el } from '../lib/dom.js';
import { loadPdfLib } from '../lib/pdf.js';
import { ensureCss, tr, ic, btn, userError, guardPrimary, statusLine, passwordInput, strengthMeter, generatePassword, passwordStrength, pdfBlob } from '../lib/sec-ui.js';

const secret = { user: '', confirm: '', owner: '' };
let ui = null;

const PERMS = [
  { id: 'allowPrint', de: 'Drucken erlauben', en: 'Allow printing' },
  { id: 'allowCopy', de: 'Text kopieren erlauben', en: 'Allow copying text' },
  { id: 'allowEdit', de: 'Ändern, Kommentieren und Formulare erlauben', en: 'Allow changes, comments and forms' },
];

export default {
  options: [
    {
      id: 'mode', type: 'radio', default: 'open',
      label: { de: 'Schutz', en: 'Protection' },
      choices: [
        { value: 'open', label: { de: 'Passwort zum Öffnen', en: 'Password to open' }, hint: { de: 'Ohne Passwort lässt sich die PDF nicht ansehen – empfohlen', en: 'Nobody can view the PDF without the password – recommended' } },
        { value: 'restrict', label: { de: 'Nur Rechte einschränken', en: 'Restrict permissions only' }, hint: { de: 'Öffnen geht ohne Passwort, Drucken/Kopieren/Ändern wird eingeschränkt', en: 'Opens without a password; printing/copying/changing is restricted' } },
      ],
    },
    {
      id: 'restrict', type: 'toggle', default: false,
      when: v => v.mode === 'open',
      label: { de: 'Zusätzlich Rechte einschränken', en: 'Also restrict permissions' },
      hint: { de: 'Legt fest, was andere nach dem Öffnen dürfen.', en: 'Decide what others may do after opening.' },
    },
    ...PERMS.map(p => ({
      id: p.id, type: 'toggle', default: p.id === 'allowPrint',
      when: v => v.mode === 'restrict' || v.restrict,
      label: { de: p.de, en: p.en },
    })),
  ],

  mountStage(stage, state, ctx) {
    ensureCss();
    const L = ctx.lang;
    const bump = () => { state.values.pwRev = (state.values.pwRev || 0) + 1; state.results?.clear?.(); };
    const status = statusLine();
    const meter = strengthMeter(L, 'sec-pw-meter');
    const user = passwordInput({ id: 'sec-pw-user', lang: L, label: tr(L, 'Passwort zum Öffnen', 'Password to open'),
      describedby: 'sec-pw-meter', onInput: v => { secret.user = v; meter.update(v); status.set(''); user.input.removeAttribute('aria-invalid'); bump(); } });
    const confirm = passwordInput({ id: 'sec-pw-confirm', lang: L, label: tr(L, 'Passwort wiederholen', 'Repeat password'),
      onInput: v => { secret.confirm = v; status.set(''); confirm.input.removeAttribute('aria-invalid'); bump(); } });
    const gen = btn('dice', tr(L, 'Sicheres Passwort erzeugen', 'Generate a strong password'), () => {
      const pw = generatePassword();
      user.setValue(pw); confirm.setValue(pw);
      if (user.input.type === 'password') user.eye.click();
      status.set(tr(L, 'Neues Passwort erzeugt. Notiere oder kopiere es – ohne Passwort kommst du nicht mehr an den Inhalt.', 'New password generated. Write it down or copy it – without it you cannot get to the content any more.'), 'ok');
    });
    const copy = btn('copy', tr(L, 'Kopieren', 'Copy'), async () => {
      if (!secret.user) return;
      try { await navigator.clipboard.writeText(secret.user); status.set(tr(L, 'Passwort in die Zwischenablage kopiert.', 'Password copied to the clipboard.'), 'ok'); }
      catch { status.set(tr(L, 'Kopieren ist hier nicht erlaubt – markiere das Passwort und kopiere es selbst.', 'Copying is not allowed here – select the password and copy it yourself.'), 'error'); }
    });
    const owner = passwordInput({ id: 'sec-pw-owner', lang: L, label: tr(L, 'Eigentümer-Passwort (optional)', 'Owner password (optional)'),
      hint: tr(L, 'Damit kannst du die Rechte später wieder ändern. Leer = ein zufälliges, das niemand kennt.', 'Lets you change the permissions later. Empty = a random one nobody knows.'),
      onInput: v => { secret.owner = v; bump(); } });
    const openBox = el('div', { class: 'sec-card' },
      el('h3', { class: 'sec-h' }, ic('lock'), tr(L, 'Passwort festlegen', 'Choose a password')),
      user.node, meter.node, confirm.node,
      el('div', { class: 'sec-row' }, gen, copy),
      el('p', { class: 'sec-info' }, ic('shield'), tr(L,
        'Verschlüsselt mit AES-256. Das Passwort verlässt dein Gerät nicht und wird nirgends gespeichert. Vergisst du es, kann niemand die Datei wieder öffnen – auch wir nicht.',
        'Encrypted with AES-256. The password never leaves your device and is not stored anywhere. If you forget it, nobody can open the file again – not even us.')));
    const ownerBox = el('details', { class: 'sec-details' }, el('summary', {}, ic('settings'), tr(L, 'Eigentümer-Passwort', 'Owner password')),
      el('div', { class: 'sec-body' }, owner.node,
        el('p', { class: 'sec-small' }, tr(L, 'Rechte-Einschränkungen werden von den meisten Programmen beachtet, sind aber kein echter Kopierschutz – für vertrauliche Inhalte immer ein Passwort zum Öffnen nutzen.',
          'Permission restrictions are respected by most programs but are not real copy protection – for confidential content always use a password to open.'))));
    stage.classList.add('sec-stage');
    stage.append(openBox, ownerBox, status.node);
    ui = { openBox, ownerBox, user, confirm, owner, meter, status };
    const sync = () => {
      const restrictOnly = state.values.mode === 'restrict';
      openBox.hidden = restrictOnly;
      ownerBox.open = ownerBox.open || restrictOnly;
    };
    sync();
    this._sync = sync;
    guardPrimary(stage, state, () => problem(state.values, L), msg => {
      status.set(msg, 'error');
      const target = state.values.mode === 'restrict' ? null : (!secret.user ? user.input : confirm.input);
      if (target) { target.setAttribute('aria-invalid', 'true'); target.focus(); }
      status.node.scrollIntoView({ block: 'center' });
    });
  },

  onOptionsChange() { this._sync?.(); },

  onInputs(inputs) {
    if (!inputs.length && ui) { // new start: forget the passwords
      for (const k of Object.keys(secret)) secret[k] = '';
      for (const f of [ui.user, ui.confirm, ui.owner]) f.input.value = '';
      ui.meter.update('');
    }
  },

  async run(inputs, opts, ctx) {
    const msg = problem(opts, ctx.lang);
    if (msg) throw userError(msg, msg);
    const PDFLib = await loadPdfLib();
    const { encryptDocument } = await import('../lib/shared/pdfcrypt.js');
    const restrictOnly = opts.mode === 'restrict';
    const restricted = restrictOnly || opts.restrict;
    const permissions = restricted ? { printing: !!opts.allowPrint, copying: !!opts.allowCopy, editing: !!opts.allowEdit } : { printing: true, copying: true, editing: true };
    const outputs = [];
    let wasProtected = 0;
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const part = (x, t) => ctx.progress((f + x) / inputs.length, inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: ${t.de}`, en: `File ${f + 1} of ${inputs.length}: ${t.en}` } : t);
      part(0, { de: 'Wird gelesen …', en: 'Reading …' });
      const doc = await input.pdfDoc();
      if (doc.wtEncrypted) wasProtected++;
      await ctx.tick();
      part(0.1, { de: 'Wird verschlüsselt …', en: 'Encrypting …' });
      doc.setProducer('FaLe Werkzeuge (fale.network)');
      doc.setModificationDate(new Date());
      await encryptDocument(PDFLib, doc, {
        userPassword: restrictOnly ? '' : secret.user,
        ownerPassword: secret.owner || '',
        permissions,
        onProgress: x => part(0.1 + 0.8 * x, { de: 'Wird verschlüsselt …', en: 'Encrypting …' }),
      });
      await ctx.tick();
      part(0.92, { de: 'Wird gespeichert …', en: 'Saving …' });
      const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
      const suffix = ctx.lang === 'de' ? ' (geschützt)' : ' (protected)';
      outputs.push({ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount(),
        note: restrictOnly ? ctx.t({ de: 'AES-256 · öffnet ohne Passwort, Rechte eingeschränkt', en: 'AES-256 · opens without a password, permissions restricted' })
          : ctx.t({ de: 'AES-256 · Passwort zum Öffnen', en: 'AES-256 · password to open' }) });
      await ctx.tick();
    }
    if (wasProtected) ctx.note({ de: 'Bereits geschützte Dateien haben jetzt nur noch das neue Passwort.', en: 'Files that were already protected now only have the new password.' });
    if (!restrictOnly) ctx.note({ de: 'Teste die Datei am besten einmal mit deinem Passwort, bevor du das Original löschst.', en: 'Best test the file once with your password before deleting the original.' });
    return { outputs };
  },
};

function problem(values, L) {
  if (values.mode === 'restrict') {
    if (!values.allowPrint && !values.allowCopy && !values.allowEdit) return '';
    if (values.allowPrint && values.allowCopy && values.allowEdit) return tr(L, 'Wähle mindestens ein Recht ab, das eingeschränkt werden soll.', 'Turn off at least one permission to restrict.');
    return '';
  }
  if (!secret.user) return tr(L, 'Gib zuerst ein Passwort ein oder lass dir eins erzeugen.', 'Enter a password first or generate one.');
  if (secret.user !== secret.confirm) return tr(L, 'Die beiden Passwörter stimmen nicht überein.', 'The two passwords don’t match.');
  if (secret.owner && secret.owner === secret.user && (values.restrict)) return tr(L, 'Das Eigentümer-Passwort muss sich vom Passwort zum Öffnen unterscheiden – sonst gelten die Einschränkungen nicht.', 'The owner password must differ from the open password – otherwise the restrictions don’t apply.');
  if (passwordStrength(secret.user).score === 0 && secret.user.length < 4) return tr(L, 'Das Passwort ist zu kurz – nimm mindestens 4 Zeichen, besser deutlich mehr.', 'The password is too short – use at least 4 characters, ideally many more.');
  return '';
}
