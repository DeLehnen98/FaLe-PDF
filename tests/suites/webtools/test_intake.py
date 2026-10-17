"""Intake + interaction details: drag & drop, paste, keyboard reorder, remove + focus, RC4 / owner-only
encrypted PDFs, cancel, wrong file type, single-file replacement semantics."""
import base64
from wtlib import Suite, FIX

DROP = """async ([b64, name, type, kind]) => {
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type }));
  const target = document.querySelector('[data-wt-drop]');
  if (kind === 'drop') {
    for (const t of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  } else {
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
}"""
b64 = lambda n: base64.b64encode((FIX / n).read_bytes()).decode()

with Suite('intake') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/pdf-zusammenfuegen/')
    page.evaluate(DROP, [b64('encrypted_rc4.pdf'), 'encrypted_rc4.pdf', 'application/pdf', 'drop'])
    page.evaluate(DROP, [b64('restricted.pdf'), 'restricted.pdf', 'application/pdf', 'paste'])
    page.evaluate(DROP, [base64.b64encode(b'Hallo Welt').decode(), 'notizen.txt', 'text/plain', 'drop'])
    s.wait_ready(page, 2)
    s.expect(page.locator('.wt-notice').is_visible() and 'notizen.txt' in page.locator('.wt-notice').inner_text(), 'wrong file type notice')
    s.expect(page.locator('.wt-file.is-locked').count() == 1, 'RC4 file asks for a password, owner-only file does not')
    page.fill('.wt-lock input', 'geheim'); page.keyboard.press('Enter')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    # keyboard reorder on the grip
    page.locator('.wt-file').nth(1).locator('.wt-grip').focus()
    page.keyboard.press('ArrowUp')
    names = page.locator('.wt-file .wt-file-name').all_inner_texts()
    s.expect(names == ['restricted.pdf', 'encrypted_rc4.pdf'], f'keyboard reorder: {names}')
    s.expect(page.evaluate("() => document.activeElement.classList.contains('wt-grip')"), 'focus stays on the grip')
    page.wait_for_timeout(100)
    s.expect('Position 1 von 2' in page.locator('.wt-app p[aria-live]').inner_text(), 'reorder is announced')
    out = s.run_and_download(page)
    s.expect(out and s.pdf_pages(out) == 8, 'RC4 + owner-only encrypted merge → 8 pages')
    # remove → focus moves sensibly, pick zone comes back after the last file
    page.locator('.wt-restart button').first.click()  # back to files
    page.locator('.wt-file .wt-rm').first.click()
    s.expect(page.evaluate("() => document.activeElement.classList.contains('wt-rm')"), 'focus moves to the next remove button')
    page.locator('.wt-file .wt-rm').first.click()
    s.expect(page.locator('[data-wt-pick]').is_visible(), 'pick zone visible again')
    s.check_page(page)

    # cancel a long run (strong compression of the photo PDF)
    page = s.open(ctx, '/werkzeuge/pdf-komprimieren/')
    s.pick(page, 'photos.pdf'); s.wait_ready(page, 1)
    page.locator('input[value="strong"]').check()
    s.primary(page).click()
    page.wait_for_selector('.wt-progress:not([hidden])')
    page.locator('.wt-progress button').click()
    page.wait_for_selector('.wt-progress', state='hidden')
    s.expect(page.locator('.wt-file').count() == 1 and page.locator('.wt-bar').is_visible(), 'cancel returns to the file list')
    s.check_page(page)
