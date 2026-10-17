import os, subprocess; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite, OUT
from pypdf import PdfReader
with Suite('aud2-try-form') as s:
    page = s.open(s.context('phone', 'de'), '/werkzeuge/pdf-formular-ausfuellen/')
    s.pick(page, 'aud2/hard_form.pdf'); s.wait_ready(page, 1)
    page.wait_for_timeout(2500)
    info = page.evaluate("""() => [...document.querySelectorAll('#wt-app input, #wt-app select, #wt-app textarea')].filter(e=>e.offsetParent).map(e => {
      const l = e.id && document.querySelector('label[for="'+e.id+'"]'); return [l ? l.textContent.trim().slice(0,30) : (e.closest('label')||{}).textContent?.trim().slice(0,30), e.tagName, e.type, e.inputMode, e.autocomplete, e.maxLength, e.placeholder]})""")
    for i in info: print(i)
    s.shot(page, 'aud2_form_try', full=True)
