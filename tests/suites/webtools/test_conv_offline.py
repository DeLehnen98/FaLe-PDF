"""Offline (agent conv): after the first visit, pdf-to-word and text-to-pdf work without network (the service
worker warmed the docx library, the synced office modules and the Unicode font). Own server on :8732, stopped."""
import os
os.environ['WT_PORT'] = '8732'
from wtlib import Suite

with Suite('conv-offline') as s:
    ctx = s.context('phone', 'de')
    p1 = s.open(ctx, '/werkzeuge/pdf-in-word/')
    p1.wait_for_function("() => document.documentElement.dataset.wtOffline === 'ready'", timeout=90000)
    p2 = s.open(ctx, '/werkzeuge/text-in-pdf/')
    p2.wait_for_function("() => document.documentElement.dataset.wtOffline === 'ready'", timeout=90000)
    assert s.proc, 'needs its own server'
    s.proc.kill(); s.proc.wait(); s.proc = None
    ctx.set_offline(True)
    p1.reload(); p1.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
    s.pick(p1, 'conv_report.pdf'); s.wait_ready(p1, 1)
    out = s.run_and_download(p1)
    s.expect(out and out.stat().st_size > 10000, 'pdf-to-word offline')
    p2.reload(); p2.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
    s.pick(p2, 'conv_text.txt'); s.wait_ready(p2, 1)
    out = s.run_and_download(p2)
    s.expect(out and 'Привет' in s.pdf_text(out), 'text-to-pdf offline with Unicode font')
    ctx.set_offline(False)
