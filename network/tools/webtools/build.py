#!/usr/bin/env python3
"""FaLe Werkzeuge (FaleNetwork web tools) – static page generator.

Reads one spec per tool from network/tools/webtools/specs/<id>.json and writes

    network/werkzeuge/index.html                 DE hub
    network/werkzeuge/<slug_de>/index.html       DE tool pages
    network/en/tools/index.html                  EN hub
    network/en/tools/<slug_en>/index.html        EN tool pages
    network/werkzeuge/teilen/index.html          landing for the share target (GET fallback, noindex)
    network/en/tools/share/index.html
    network/werkzeuge/manifest.webmanifest       installable "FaLe Werkzeuge" app with share_target
    network/en/tools/manifest.webmanifest
    network/sw.js                                service worker (scope /), versioned by content hashes
    network/sitemap.xml                          merged: existing URLs are kept, tool URLs added/updated

Header, footer and <head> come from network/tools/build_pages.py so the tools look like the rest of
the site. Run both generators (order matters, build_pages.py rewrites sitemap.xml from scratch):

    python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py

The output is deterministic (no timestamps), so running it twice produces no diff.
Contract for adding tools: network/tools/webtools/README.md
"""
import hashlib
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # no __pycache__ inside the deployed folder
sys.path.insert(0, str(HERE.parent))
import build_pages as bp  # noqa: E402  (shared head/header/footer, BASE, PDF_APP …)

ROOT = bp.ROOT                      # network/
BASE = bp.BASE
SPECS = HERE / 'specs'
WT = ROOT / 'assets' / 'wt'
HUB = {'de': '/werkzeuge/', 'en': '/en/tools/'}
SHARE_ACTION = {'de': '/werkzeuge/teilen/', 'en': '/en/tools/share/'}
SHARE_LANDING = {'de': '/werkzeuge/?geteilt=1', 'en': '/en/tools/?shared=1'}
MANIFEST = {'de': '/werkzeuge/manifest.webmanifest', 'en': '/en/tools/manifest.webmanifest'}
OG_IMAGE = {'de': '/assets/og/og-tools-de.png', 'en': '/assets/og/og-tools-en.png'}
LANGS = ('de', 'en')
VORLAGEN_SCOPES = ['/vorlagen/', '/en/templates/']  # pages of the Vorlagen-Archiv: network first, offline copy

# ------------------------------------------------------------------ categories (fixed order)
# id (used in specs) -> per language (anchor slug, label, one-line description), colour token
CATEGORIES = [
    ('organize', {'de': ('organisieren', 'Organisieren', 'Zusammenfügen, sortieren, teilen'),
                  'en': ('organize', 'Organize', 'Merge, reorder, split')}, 'organize'),
    ('optimize', {'de': ('optimieren', 'Optimieren', 'Kleiner, reparieren, aufräumen'),
                  'en': ('optimize', 'Optimize', 'Smaller, repaired, tidy')}, 'ai'),
    ('convert-to-pdf', {'de': ('in-pdf', 'In PDF umwandeln', 'Bilder und Dokumente zu PDF'),
                        'en': ('convert-to-pdf', 'Convert to PDF', 'Images and documents to PDF')}, 'convert'),
    ('convert-from-pdf', {'de': ('aus-pdf', 'PDF umwandeln', 'PDF in Bilder, Text und mehr'),
                          'en': ('convert-from-pdf', 'Convert from PDF', 'PDF to images, text and more')}, 'read'),
    ('edit', {'de': ('bearbeiten', 'Bearbeiten', 'Text, Seitenzahlen, Wasserzeichen'),
              'en': ('edit', 'Edit', 'Text, page numbers, watermarks')}, 'edit'),
    ('security', {'de': ('sicherheit', 'Sicherheit', 'Schützen, entsperren, schwärzen'),
                  'en': ('security', 'Security', 'Protect, unlock, redact')}, 'secure'),
    ('images', {'de': ('bilder', 'Bilder', 'Fotos verkleinern, zuschneiden, umwandeln'),
                'en': ('images', 'Images', 'Resize, crop and convert photos')}, 'scan'),
    ('everyday', {'de': ('alltag', 'Alltag', 'Praktisches für Formulare und Belege'),
                  'en': ('everyday', 'Everyday', 'Handy helpers for forms and receipts')}, 'share'),
    ('calc', {'de': ('rechner', 'Rechner & Text', 'Mehrwertsteuer, Prozente, Datum, Zeichen'),
              'en': ('calculators', 'Calculators & text', 'VAT, percentages, dates, characters')}, 'read'),
]
CAT = {cid: (labels, colour) for cid, labels, colour in CATEGORIES}

# ------------------------------------------------------------------ icons (24 px grid, stroke 2)
# A spec uses "icon": "<name>" from this set, or brings its own "iconSvg" (inner SVG markup for a
# 24×24 stroke icon, e.g. '<path d="…"/>') – so new tools never need to edit this file.
ICONS = {
    'merge': '<path d="M7 3h7l4 4v6"/><path d="M14 3v4h4"/><path d="M7 3v12"/><path d="M4 18h9"/><path d="M10 15l3 3-3 3"/>',
    'split': '<path d="M6 3h8l4 4v14H6z"/><path d="M3 12h4M17 12h4"/><path d="M10 12h4" stroke-dasharray="1 2.5"/>',
    'compress': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 8v4M10 10.5l2 2 2-2"/><path d="M12 18v-3M10 15.5l2-2 2 2"/>',
    'image-pdf': '<rect x="3" y="4" width="13" height="11" rx="2"/><path d="M3 12l3.5-3.5 3 3 2-2L16 14"/><circle cx="12" cy="7.5" r="1"/><path d="M14 18h7M18 15l3 3-3 3"/>',
    'pdf-image': '<path d="M6 3h8l4 4v6"/><path d="M14 3v4h4"/><rect x="9" y="14" width="12" height="8" rx="1.5"/><path d="M9 20l3-2.5 2.5 2 2-1.5 4.5 3"/>',
    'pages': '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'rotate': '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    'extract': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 10v7M9 14l3 3 3-3"/>',
    'delete': '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
    'lock': '<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    'unlock': '<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.6-1.7"/>',
    'sign': '<path d="M3 17c2.5-4 4.5-6 6-6s-1 6 1 6 3-5 5-5 1 3 3 3h3"/><path d="M3 21h18"/>',
    'edit': '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    'text': '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    'watermark': '<path d="M6 3h8l4 4v14H6z"/><path d="M9 16l6-6M9 12l3-3M12 17l3-3"/>',
    'numbers': '<path d="M6 3h8l4 4v14H6z"/><path d="M11 17h2M12 13v4"/>',
    'crop': '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
    'camera': '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    'scan': '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
    'ocr': '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M12 9v7"/>',
    'doc': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6M9 18h4"/>',
    'sheet': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    'slides': '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>',
    'resize': '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    'photo': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 18l5-5 4 4 3-3 6 6"/>',
    'wifi': '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19.5" r="1"/>',
    'qr': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M17 20h4v-3"/>',
    'stamp': '<path d="M9 13V9.5A3 3 0 1 1 15 9.5V13"/><path d="M4 13h16v4H4zM6 21h12"/>',
    'form': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8"/><rect x="8" y="15" width="4" height="3" rx=".5"/>',
    'compare': '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/><path d="M12 2v20"/>',
    'redact': '<path d="M6 3h8l4 4v14H6z"/><path d="M9 11h6v3H9z" fill="currentColor"/><path d="M9 17h4"/>',
    'repair': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
    'zip': '<path d="M6 3h8l4 4v14H6z"/><path d="M10 3v2h2v2h-2v2h2v2h-2v2"/><rect x="9.5" y="14" width="3" height="3" rx=".5"/>',
    'grayscale': '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    'flatten': '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    'calendar': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    'receipt': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    'tool': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>',
}
UI_ICONS = {
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'arrow': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'upload': '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    'device': '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    'infinity': '<path d="M7 9c-2.2 0-4 1.3-4 3s1.8 3 4 3c3.5 0 6.5-6 10-6 2.2 0 4 1.3 4 3s-1.8 3-4 3c-3.5 0-6.5-6-10-6z"/>',
    'nodrop': '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-9.6 4.8"/><path d="M7.1 14.6A6 6 0 0 1 6 14c0-2.4 1.7-5.3 3.4-7.6"/><path d="M3 3l18 18"/>',
    'no-user': '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/><path d="M3 3l18 18"/>',
    'shield': '<path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    'star': '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    'camera': ICONS['camera'],
    'paste': '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
}


def svg(inner, cls=''):
    c = f' class="{cls}"' if cls else ''
    return (f'<svg{c} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{inner}</svg>')


def tool_icon(spec, cls='wt-icon'):
    return svg(spec.get('iconSvg') or ICONS.get(spec.get('icon'), ICONS['tool']), cls)


def e(text):
    """Escape plain spec text for HTML text and attributes."""
    return html.escape(str(text), quote=True)


# ------------------------------------------------------------------ texts shared by all tool pages
S = {
    'de': {
        'hub_title': 'PDF- und Bild-Werkzeuge online – ohne Upload | FaleNetwork',
        'hub_desc': 'Online-Werkzeuge für PDF und Bilder: zusammenfügen, komprimieren, umwandeln. Alles läuft in deinem Browser – ohne Upload, ohne Konto, ohne Wasserzeichen.',
        'hub_h1': 'Werkzeuge für PDF und Bilder',
        'hub_lede': 'Direkt im Browser. Deine Dateien bleiben auf deinem Gerät.',
        'hub_name': 'Werkzeuge', 'crumbs': 'Navigationspfad', 'home': 'Start',
        'search_label': 'Werkzeug suchen', 'search_ph': 'z. B. verkleinern, JPG',
        'no_hits': 'Kein Werkzeug gefunden. Probier ein anderes Wort – oder schau in der FaLe PDF App, dort gibt es über 40 Werkzeuge.',
        'cats_label': 'Kategorien', 'all': 'Alle', 'popular': 'Oft genutzt', 'by_topic': 'Alle Werkzeuge nach Thema',
        'shared_h': 'Was möchtest du damit machen?',
        'shared_none': 'Für diese Dateien gibt es hier noch kein passendes Werkzeug.',
        'shared_empty': 'Es wurden keine Dateien empfangen. Teile eine PDF oder ein Bild erneut mit „FaLe Werkzeuge“.',
        'hub_about_h': 'So funktionieren die FaLe Werkzeuge',
        'hub_about': [
            ('Alles im Browser', 'Jedes Werkzeug läuft in deinem Browser-Tab. Deine Dateien werden nicht hochgeladen – auch nicht kurz zur Verarbeitung.'),
            ('Ohne Konto und Limits', 'Keine Anmeldung, keine Tageslimits und keine Wasserzeichen. Grenzen setzt nur der Speicher deines Geräts.'),
            ('Auch offline', 'Nach dem ersten Laden funktionieren die Werkzeuge auch ohne Internet. Auf Android kannst du sie installieren und Dateien direkt hierher teilen.'),
        ],
        'trust': [('device', 'Bleibt auf deinem Gerät'), ('infinity', 'Ohne Limits'), ('nodrop', 'Ohne Wasserzeichen'), ('no-user', 'Ohne Konto')],
        'trust_label': 'Darauf kannst du dich verlassen',
        'proof_sum': 'Wie prüfe ich, dass nichts hochgeladen wird?',
        'proof': [
            'Deine Dateien werden in diesem Browser-Tab verarbeitet. Diese Seite hat keine Funktion, die Dateien an einen Server schickt, und ihre Sicherheitsregeln (Content Security Policy) verbieten Verbindungen zu fremden Servern.',
            'So prüfst du es selbst: Lade diese Seite, schalte dann den Flugmodus ein oder trenne das WLAN und starte das Werkzeug. Es funktioniert trotzdem – weil alles auf deinem Gerät passiert.',
        ],
        'pick_pdf': 'PDF auswählen', 'pick_img': 'Bilder auswählen', 'pick_any': 'Dateien auswählen',
        'pick_sub': 'oder hierher ziehen', 'camera': 'Kamera', 'paste': 'Einfügen',
        'noscript': 'Dieses Werkzeug braucht JavaScript, weil es deine Dateien direkt in deinem Browser verarbeitet. Bitte aktiviere JavaScript oder nutze die FaLe PDF App.',
        'tool_label': 'Werkzeug',
        'info_h': 'Gut zu wissen', 'how_h': 'So geht’s – Schritt für Schritt', 'why_h': 'Warum mit FaLe?', 'faq_h': 'Häufige Fragen', 'related_h': 'Passende Werkzeuge',
        'cmp_caption': 'FaLe Werkzeuge im Vergleich mit typischen Online-Werkzeugen',
        'cmp_cols': ('', 'FaLe Werkzeuge', 'Typische Online-Werkzeuge'),
        'cmp_rows': [
            ('Wo werden Dateien verarbeitet?', 'In deinem Browser, auf deinem Gerät', 'Meist auf dem Server des Anbieters – die Datei wird hochgeladen'),
            ('Konto nötig?', 'Nein', 'Oft für größere Dateien oder mehr Durchgänge'),
            ('Limits', 'Keine künstlichen Limits', 'Häufig Tageslimits oder Größengrenzen in der Gratisversion'),
            ('Wasserzeichen', 'Nie', 'Bei manchen Anbietern in der Gratisversion'),
            ('Offline nutzbar', 'Ja, nach dem ersten Laden', 'Nein'),
            ('Werbung und Tracking', 'Keine', 'Häufig Werbebanner und Analyse-Dienste'),
        ],
        'app_h': 'Mehr Funktionen in der FaLe PDF App',
        'app_p': 'Unterschreiben, Formulare ausfüllen, scannen mit Texterkennung und über 40 weitere Werkzeuge – ohne Konto und auch offline.',
        'app_open': 'FaLe PDF öffnen', 'app_more': 'Mehr zu FaLe PDF',
        'tm_note': 'Genannte Dateiformate und Produktnamen dienen nur der Beschreibung der unterstützten Formate. Marken gehören ihren jeweiligen Inhabern; FaleNetwork steht mit ihnen in keiner Verbindung.',
        'browser_req': 'Benötigt JavaScript und einen aktuellen Browser (Chrome, Edge, Firefox oder Safari).',
        'share_title': 'Geteilte Dateien | FaLe Werkzeuge',
        'share_h1': 'Geteilte Dateien',
        'share_p': 'Hier landen Dateien, die du auf Android über „Teilen“ an die installierten FaLe Werkzeuge schickst. Gerade ist nichts angekommen.',
        'share_link': 'Zu allen Werkzeugen',
        'app_name': 'FaLe Werkzeuge', 'app_short': 'Werkzeuge',
        'app_desc': 'PDF- und Bild-Werkzeuge, die direkt auf deinem Gerät arbeiten.',
        'og_alt': 'FaLe Werkzeuge – PDF und Bilder bearbeiten, direkt im Browser',
    },
    'en': {
        'hub_title': 'Online PDF and image tools – no upload | FaleNetwork',
        'hub_desc': 'Online tools for PDFs and images: merge, compress, convert. Everything runs in your browser – no upload, no account, no watermark.',
        'hub_h1': 'Tools for PDFs and images',
        'hub_lede': 'Right in your browser. Your files stay on your device.',
        'hub_name': 'Tools', 'crumbs': 'Breadcrumb', 'home': 'Home',
        'search_label': 'Search tools', 'search_ph': 'e.g. compress, JPG',
        'no_hits': 'No tool found. Try another word – or have a look at the FaLe PDF app, which has more than 40 tools.',
        'cats_label': 'Categories', 'all': 'All', 'popular': 'Popular', 'by_topic': 'All tools by topic',
        'shared_h': 'What would you like to do with it?',
        'shared_none': 'There is no matching tool for these files here yet.',
        'shared_empty': 'No files were received. Share a PDF or an image with “FaLe Tools” again.',
        'hub_about_h': 'How FaLe Tools work',
        'hub_about': [
            ('Everything in your browser', 'Every tool runs in your browser tab. Your files are not uploaded – not even briefly for processing.'),
            ('No account, no limits', 'No sign-up, no daily limits and no watermarks. The only limit is your device’s memory.'),
            ('Offline, too', 'After the first visit the tools also work without internet. On Android you can install them and share files straight to them.'),
        ],
        'trust': [('device', 'Stays on your device'), ('infinity', 'No limits'), ('nodrop', 'No watermark'), ('no-user', 'No account')],
        'trust_label': 'What you can rely on',
        'proof_sum': 'How can I check that nothing is uploaded?',
        'proof': [
            'Your files are processed in this browser tab. This page has no function that sends files to a server, and its security rules (Content Security Policy) forbid connections to other servers.',
            'Check it yourself: load this page, then switch on flight mode or disconnect Wi-Fi and run the tool. It still works – because everything happens on your device.',
        ],
        'pick_pdf': 'Choose PDF', 'pick_img': 'Choose images', 'pick_any': 'Choose files',
        'pick_sub': 'or drop them here', 'camera': 'Camera', 'paste': 'Paste',
        'noscript': 'This tool needs JavaScript because it processes your files right in your browser. Please enable JavaScript or use the FaLe PDF app.',
        'tool_label': 'Tool',
        'info_h': 'Good to know', 'how_h': 'How it works – step by step', 'why_h': 'Why FaLe?', 'faq_h': 'Frequently asked questions', 'related_h': 'Related tools',
        'cmp_caption': 'FaLe Tools compared with typical online tools',
        'cmp_cols': ('', 'FaLe Tools', 'Typical online tools'),
        'cmp_rows': [
            ('Where are files processed?', 'In your browser, on your device', 'Usually on the provider’s server – the file is uploaded'),
            ('Account needed?', 'No', 'Often for larger files or more runs'),
            ('Limits', 'No artificial limits', 'Often daily limits or size caps in the free version'),
            ('Watermark', 'Never', 'With some providers in the free version'),
            ('Works offline', 'Yes, after the first visit', 'No'),
            ('Ads and tracking', 'None', 'Often banner ads and analytics services'),
        ],
        'app_h': 'More features in the FaLe PDF app',
        'app_p': 'Sign, fill in forms, scan with text recognition and more than 40 other tools – no account and offline, too.',
        'app_open': 'Open FaLe PDF', 'app_more': 'More about FaLe PDF',
        'tm_note': 'File formats and product names are mentioned only to describe the supported formats. Trademarks belong to their respective owners; FaleNetwork is not affiliated with them.',
        'browser_req': 'Requires JavaScript and a current browser (Chrome, Edge, Firefox or Safari).',
        'share_title': 'Shared files | FaLe Tools',
        'share_h1': 'Shared files',
        'share_p': 'Files you send to the installed FaLe Tools with “Share” on Android arrive here. Nothing has arrived right now.',
        'share_link': 'See all tools',
        'app_name': 'FaLe Tools', 'app_short': 'Tools',
        'app_desc': 'PDF and image tools that work right on your device.',
        'og_alt': 'FaLe Tools – work with PDFs and images right in your browser',
    },
}

# ------------------------------------------------------------------ spec loading + validation
REQUIRED = ['id', 'category', 'module', 'accepts']
REQUIRED_LANG = ['slug', 'name', 'title', 'h1', 'metaDescription', 'lede', 'primaryButton', 'steps', 'faq', 'why']
SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
BANNED = re.compile(r'\b(adobe|acrobat|wps|ilovepdf|smallpdf|pdf24|sejda|microsoft|foxit|nitro|soda ?pdf|pdfescape|google)\b', re.I)


class SpecError(Exception):
    pass


def load_specs():
    specs, errors, warnings = [], [], []
    for f in sorted(SPECS.glob('*.json')):
        try:
            sp = json.loads(f.read_text(encoding='utf-8'))
        except json.JSONDecodeError as ex:
            errors.append(f'{f.name}: invalid JSON ({ex})')
            continue
        where = f.name
        for k in REQUIRED:
            if k not in sp:
                errors.append(f'{where}: missing "{k}"')
        if sp.get('id') and f.stem != sp['id']:
            errors.append(f'{where}: file name must be "{sp["id"]}.json"')
        if sp.get('category') not in CAT:
            errors.append(f'{where}: unknown category "{sp.get("category")}" (one of {", ".join(CAT)})')
        if not sp.get('iconSvg') and sp.get('icon') not in ICONS:
            errors.append(f'{where}: unknown icon "{sp.get("icon")}" – use one of {", ".join(sorted(ICONS))} or "iconSvg"')
        mod = sp.get('module', '')
        if not re.match(r'^tools/[a-z0-9-]+\.js$', mod or ''):
            errors.append(f'{where}: module must look like "tools/<id>.js"')
        elif not (WT / mod).is_file():
            errors.append(f'{where}: module file network/assets/wt/{mod} does not exist')
        # minFiles: 0 = tool without file intake (generator); its "accepts" may be empty
        if not isinstance(sp.get('accepts'), list) or (not sp.get('accepts') and sp.get('minFiles', 1) != 0):
            errors.append(f'{where}: "accepts" must be a non-empty list of MIME types / extensions')
        for lang in LANGS:
            c = sp.get(lang)
            if not isinstance(c, dict):
                errors.append(f'{where}: missing "{lang}" block')
                continue
            for k in REQUIRED_LANG:
                if not c.get(k):
                    errors.append(f'{where}: {lang}.{k} missing or empty')
            if c.get('slug') and not SLUG_RE.match(c['slug']):
                errors.append(f'{where}: {lang}.slug "{c["slug"]}" must be lowercase a-z, 0-9 and dashes')
            if len(c.get('steps', [])) != 3:
                errors.append(f'{where}: {lang}.steps must have exactly 3 entries')
            for st in c.get('steps', []):
                if not (isinstance(st, dict) and st.get('title') and st.get('text')):
                    errors.append(f'{where}: {lang}.steps entries need "title" and "text"')
            for q in c.get('faq', []):
                if not (isinstance(q, dict) and q.get('q') and q.get('a')):
                    errors.append(f'{where}: {lang}.faq entries need "q" and "a"')
            for w in c.get('why', []):
                if not (isinstance(w, dict) and w.get('title') and w.get('text')):
                    errors.append(f'{where}: {lang}.why entries need "title" and "text"')
            text = json.dumps(c, ensure_ascii=False)
            m = BANNED.search(text)
            if m:
                errors.append(f'{where}: {lang} mentions a third-party brand ("{m.group(0)}") – not allowed')
            if len(c.get('title', '')) > 70:
                warnings.append(f'{where}: {lang}.title is {len(c["title"])} chars (aim for ≤ 65)')
            d = len(c.get('metaDescription', ''))
            if d and not 70 <= d <= 170:
                warnings.append(f'{where}: {lang}.metaDescription is {d} chars (aim for 110–160)')
        specs.append(sp)
    ids = {sp.get('id') for sp in specs}
    for lang in LANGS:
        seen = {}
        for sp in specs:
            slug = sp.get(lang, {}).get('slug')
            if slug in seen:
                errors.append(f'{lang} slug "{slug}" used by {seen[slug]} and {sp["id"]}')
            if slug in ('teilen', 'share', 'manifest.webmanifest'):
                errors.append(f'{sp["id"]}: {lang} slug "{slug}" is reserved')
            seen[slug] = sp.get('id')
    for sp in specs:
        for k in ('related', 'next'):
            for rid in sp.get(k, []):
                if rid not in ids:
                    errors.append(f'{sp["id"]}.json: {k} references unknown tool "{rid}"')
        # "alt": [{"id", "de", "en"}] – a one-line pointer to the tool for a similar but different task
        for a in sp.get('alt', []):
            if a.get('id') not in ids or not a.get('de') or not a.get('en'):
                errors.append(f'{sp["id"]}.json: alt entries need a known "id" plus "de" and "en" text')
    for w in warnings:
        print('warning:', w, file=sys.stderr)
    if errors:
        raise SpecError('\n'.join(errors))
    specs.sort(key=lambda sp: (sp.get('order', 1000), sp['id']))
    return specs


def tool_path(sp, lang):
    return f"{HUB[lang]}{sp[lang]['slug']}/"


def pick_label(sp, lang):
    if sp[lang].get('pickLabel'):
        return sp[lang]['pickLabel']
    acc = [a.lower() for a in sp['accepts']]
    pdf = any('pdf' in a for a in acc)
    img = any(a.startswith('image/') or a in ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif') for a in acc)
    s = S[lang]
    if pdf and not img:
        return s['pick_pdf']
    if img and not pdf:
        return s['pick_img']
    return s['pick_any']


def accepts_images(sp):
    return any(a.lower().startswith('image/') for a in sp['accepts'])


def json_script(obj, id_):
    data = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True).replace('</', '<\\/')
    return f'<script type="application/json" id="{id_}">{data}</script>'


def extra_head(lang):
    return (f'\n  <link rel="preload" href="/assets/wt/vendor/fonts/BricolageGrotesque-Bold.woff" as="font" type="font/woff" crossorigin>'
            f'\n  <link rel="stylesheet" href="/assets/wt/wt.css">')


def crumbs(lang, items):
    s = S[lang]
    lis = ''.join(f'<li><a href="{h}">{e(n)}</a></li>' if h else f'<li aria-current="page">{e(n)}</li>' for n, h in items)
    return f'<nav class="wt-crumbs" aria-label="{s["crumbs"]}"><ol>{lis}</ol></nav>'


def ld_breadcrumb(items):
    return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': BASE + h} for i, (n, h) in enumerate(items)]}


def tool_card(sp, lang, heading='h3'):
    c = sp[lang]
    colour = CAT[sp['category']][1]
    kw = ' '.join([c['name'], c.get('short', ''), ' '.join(c.get('keywords', [])), sp['id']]).lower()
    return (f'<li class="wt-card" data-wt-tool="{sp["id"]}" data-cat="{sp["category"]}" data-search="{e(kw)}">'
            f'<a href="{tool_path(sp, lang)}"><span class="wt-chip-ic tic-{colour}">{tool_icon(sp)}</span>'
            f'<{heading} class="wt-card-name">{e(c["name"])}</{heading}><span class="wt-card-desc">{e(c.get("short") or c["lede"])}</span></a></li>')


# ------------------------------------------------------------------ tool page
def page_tool(sp, lang, by_id):
    s, c = S[lang], sp[lang]
    other = 'en' if lang == 'de' else 'de'
    path = tool_path(sp, lang)
    paths = (tool_path(sp, 'de'), tool_path(sp, 'en'))
    colour = CAT[sp['category']][1]
    items = [(s['home'], bp.url('home', lang)), (s['hub_name'], HUB[lang]), (c['name'], path)]
    multiple = bool(sp.get('multiple'))
    accept = ','.join(sp['accepts'])
    badges = s['trust']
    if sp['id'] in ('watermark-image', 'watermark-pdf'):   # "no watermark" would read oddly on a watermark tool
        badges = [(i, ({'de': 'Kein fremdes Logo', 'en': 'No third-party logo'}[lang] if i == 'nodrop' else t)) for i, t in badges]
    trust = ''.join(f'<li>{svg(UI_ICONS[i])}<span>{t}</span></li>' for i, t in badges)
    steps = ''.join(f'<li id="schritt-{i + 1}" class="wt-step"><h3>{e(st["title"])}</h3><p>{e(st["text"])}</p></li>' for i, st in enumerate(c['steps']))
    why = ''.join(f'<li>{svg(UI_ICONS["check"])}<div><h3>{e(w["title"])}</h3><p>{e(w["text"])}</p></div></li>' for w in c['why'])
    cmp_head = ''.join(f'<th scope="col">{e(h)}</th>' for h in s['cmp_cols'])
    cmp_rows = ''.join(f'<tr><th scope="row">{e(a)}</th><td data-label="{e(s["cmp_cols"][1])}">{e(b)}</td><td data-label="{e(s["cmp_cols"][2])}">{e(d)}</td></tr>' for a, b, d in s['cmp_rows'])
    faq = ''.join(f'<details><summary>{e(q["q"])}</summary><div><p>{e(q["a"])}</p></div></details>' for q in c['faq'])
    related = ''.join(tool_card(by_id[r], lang) for r in sp.get('related', []) if r in by_id)
    alt = ''.join(f'<p class="wt-alt">{svg(UI_ICONS["arrow"])}<span>{e(a[lang])} <a href="{tool_path(by_id[a["id"]], lang)}">{e(by_id[a["id"]][lang]["name"])}</a></span></p>'
                  for a in sp.get('alt', []) if a['id'] in by_id)
    camera = ''
    if accepts_images(sp):
        camera = (f'<label class="wt-chipbtn" data-wt-camera hidden><input class="wt-picker" type="file" accept="image/*" capture="environment" tabindex="-1">'
                  f'{svg(UI_ICONS["camera"])}<span>{s["camera"]}</span></label>')
    tm = f'<p class="wt-tm">{e(s["tm_note"])}</p>' if sp.get('trademarkNote') else ''
    proof = ''.join(f'<p>{e(p)}</p>' for p in s['proof'])
    config = {
        'v': 1, 'lang': lang, 'id': sp['id'], 'module': '/assets/wt/' + sp['module'],
        'accepts': sp['accepts'], 'multiple': multiple, 'minFiles': sp.get('minFiles', 1),
        'maxFiles': sp.get('maxFiles'), 'name': c['name'], 'primary': c['primaryButton'],
        'needs': sp.get('needs', []), 'hub': HUB[lang], 'app': bp.PDF_APP,
        'lazy': module_graph(sp['module']),
        'next': [{'id': n, 'name': by_id[n][lang]['name'], 'url': tool_path(by_id[n], lang), 'accepts': by_id[n]['accepts'], 'multiple': bool(by_id[n].get('multiple'))}
                 for n in sp.get('next', []) if n in by_id],
        'categoryColour': colour,
    }
    ld = [
        {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': c['name'], 'url': BASE + path,
         'description': c['metaDescription'], 'applicationCategory': 'UtilitiesApplication', 'operatingSystem': 'Any',
         'browserRequirements': s['browser_req'], 'inLanguage': lang,
         'publisher': {'@type': 'Organization', 'name': 'FaleNetwork', 'url': BASE + '/'}},
        {'@context': 'https://schema.org', '@type': 'HowTo', 'name': c['h1'], 'inLanguage': lang,
         'step': [{'@type': 'HowToStep', 'position': i + 1, 'name': st['title'], 'text': st['text'],
                   'url': f'{BASE}{path}#schritt-{i + 1}'} for i, st in enumerate(c['steps'])]},
        {'@context': 'https://schema.org', '@type': 'FAQPage', 'inLanguage': lang, 'mainEntity': [
            {'@type': 'Question', 'name': q['q'], 'acceptedAnswer': {'@type': 'Answer', 'text': q['a']}} for q in c['faq']]},
        ld_breadcrumb(items),
    ]
    h = bp.head(lang, 'home', e(c['title']), e(c['metaDescription']), ld, paths=paths, og_image=OG_IMAGE[lang],
                og_alt=e(s['og_alt']), manifest=MANIFEST[lang], extra_head=extra_head(lang))
    hdr = bp.header(lang, 'home', current=HUB[lang], other_url=tool_path(sp, other))
    body = f'''
<main id="main" class="wt-page" data-cat="{sp['category']}">
  <div class="wrap wt-top">
    {crumbs(lang, [(n, h if i < 2 else None) for i, (n, h) in enumerate(items)])}
    <div class="wt-head"><span class="wt-chip-ic wt-chip-lg tic-{colour}">{tool_icon(sp)}</span><div><h1>{e(c['h1'])}</h1><p class="wt-lede">{e(c['lede'])}</p></div></div>
    {alt}<section id="wt-app" class="wt-app" aria-label="{s['tool_label']}: {e(c['name'])}" data-state="pick">
      <div class="wt-pick" data-wt-pick{' hidden' if sp.get('minFiles', 1) == 0 else ''}>
        <label class="wt-drop" data-wt-drop>
          <input class="wt-picker" type="file" accept="{e(accept)}"{' multiple' if multiple else ''} data-wt-input>
          <span class="wt-drop-ic">{svg(UI_ICONS['upload'])}</span>
          <span class="wt-drop-main">{e(pick_label(sp, lang))}</span>
          <span class="wt-drop-sub">{s['pick_sub']}</span>
        </label>
        <div class="wt-chips">{camera}<button class="wt-chipbtn" type="button" data-wt-paste hidden>{svg(UI_ICONS['paste'])}<span>{s['paste']}</span></button></div>
      </div>
      <noscript><p class="wt-noscript">{s['noscript']}</p></noscript>
    </section>
    <ul class="wt-trust" aria-label="{s['trust_label']}">{trust}</ul>
    <details class="wt-proof"><summary>{svg(UI_ICONS['shield'])}<span>{s['proof_sum']}</span></summary><div>{proof}<p class="wt-proof-live" data-wt-proof hidden></p></div></details>
  </div>
  <section class="section wt-sec wt-info" aria-labelledby="info-h">
    <div class="wrap">
      <h2 id="info-h">{s['info_h']}</h2>
      <div class="wt-acc">
        <details class="wt-acc-item" id="anleitung"><summary>{s['how_h']}</summary><div><ol class="wt-steps">{steps}</ol></div></details>
        <details class="wt-acc-item"><summary>{s['why_h']}</summary><div><ul class="wt-why">{why}</ul>
          <div class="wt-cmp-wrap"><table class="wt-cmp"><caption>{s['cmp_caption']}</caption><thead><tr>{cmp_head}</tr></thead><tbody>{cmp_rows}</tbody></table></div></div></details>
        <details class="wt-acc-item"><summary>{s['faq_h']}</summary><div><div class="faq">{faq}</div></div></details>
      </div>
      {tm}
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="rel-h">
    <div class="wrap">
      <h2 id="rel-h">{s['related_h']}</h2>
      <ul class="wt-grid wt-rows">{related}</ul>
    </div>
  </section>
  {app_cta(lang)}
</main>
{json_script(config, 'wt-config')}
<script type="module" src="/assets/wt/shell.js"></script>
'''
    return h + '\n' + hdr + body + bp.footer(lang)


# ------------------------------------------------------------------ FaLe PDF app: the same tools inside the app
# The app (repo root, Android/iOS/PWA) shows every tool in a frame: <repo>/wt-app/<lang>/<id>.html holds only the
# tool itself (no site header, SEO texts or links), loads the tool code from /network/assets/wt/ (copied into the
# app build by scripts/vercel-build.mjs) and js/webtools/frame.js, which connects it to the app (save results into
# the library, share, pick files from the library, theme). js/webtools/catalog.js lists the tools for the app.
REPO = ROOT.parent
APP_PAGES = REPO / 'wt-app'
APP_CATALOG = REPO / 'js' / 'webtools' / 'catalog.js'
APP_WT = '/network/assets/wt/'
APP_ONLY_EXCLUDED = {'screen-recorder'}   # needs screen capture – not available in the app's web view


def app_csp(sp):
    img = "'self' blob: data:" + (' https:' if sp['id'] == 'email-signature' else '')
    return ("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; "
            f"img-src {img}; media-src 'self' blob:; font-src 'self'; connect-src 'self' blob: data:; worker-src 'self' blob:; "
            "base-uri 'none'; form-action 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types default")


def app_page_path(sp, lang):
    return f'/wt-app/{lang}/{sp["id"]}.html'


def page_app(sp, lang, by_id):
    s, c = S[lang], sp[lang]
    multiple = bool(sp.get('multiple'))
    accept = ','.join(sp['accepts'])
    camera = ''
    if accepts_images(sp):
        camera = (f'<label class="wt-chipbtn" data-wt-camera hidden><input class="wt-picker" type="file" accept="image/*" capture="environment" tabindex="-1">'
                  f'{svg(UI_ICONS["camera"])}<span>{s["camera"]}</span></label>')
    shared = lambda p: APP_WT + p[len('/assets/wt/'):] if p.startswith('/assets/wt/') else p
    config = {
        'v': 1, 'lang': lang, 'id': sp['id'], 'module': APP_WT + sp['module'],
        'accepts': sp['accepts'], 'multiple': multiple, 'minFiles': sp.get('minFiles', 1),
        'maxFiles': sp.get('maxFiles'), 'name': c['name'], 'primary': c['primaryButton'],
        'needs': sp.get('needs', []), 'hub': '', 'app': '', 'inApp': True,
        'lazy': [shared(p) for p in module_graph(sp['module'])],
        'next': [{'id': n, 'name': by_id[n][lang]['name'], 'url': app_page_path(by_id[n], lang), 'accepts': by_id[n]['accepts'], 'multiple': bool(by_id[n].get('multiple'))}
                 for n in sp.get('next', []) if n in by_id and n not in APP_ONLY_EXCLUDED],
        'categoryColour': CAT[sp['category']][1],
    }
    return f'''<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="{app_csp(sp)}">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <title>{e(c['name'])}</title>
  <link rel="stylesheet" href="/network/assets/fale-tokens.css">
  <link rel="stylesheet" href="/network/assets/site.css">
  <link rel="stylesheet" href="{APP_WT}wt.css">
  <link rel="stylesheet" href="/js/webtools/frame.css">
  <script src="/js/webtools/frame.js"></script>
</head>
<body class="wt-in-app">
<main id="main" class="wt-page" data-cat="{sp['category']}">
  <div class="wrap wt-top">
    <p class="wt-lede">{e(c['lede'])}</p>
    <section id="wt-app" class="wt-app" aria-label="{s['tool_label']}: {e(c['name'])}" data-state="pick">
      <div class="wt-pick" data-wt-pick{' hidden' if sp.get('minFiles', 1) == 0 else ''}>
        <label class="wt-drop" data-wt-drop>
          <input class="wt-picker" type="file" accept="{e(accept)}"{' multiple' if multiple else ''} data-wt-input>
          <span class="wt-drop-ic">{svg(UI_ICONS['upload'])}</span>
          <span class="wt-drop-main">{e(pick_label(sp, lang))}</span>
          <span class="wt-drop-sub">{s['pick_sub']}</span>
        </label>
        <div class="wt-chips">{camera}<button class="wt-chipbtn" type="button" data-wt-paste hidden>{svg(UI_ICONS['paste'])}<span>{s['paste']}</span></button></div>
      </div>
    </section>
  </div>
</main>
{json_script(config, 'wt-config')}
<script type="module" src="{APP_WT}shell.js"></script>
</body>
</html>
'''


def app_catalog(specs):
    """ES module for the app: id, category, icon (inner SVG), accepted files and the texts in both languages."""
    items = []
    for sp in specs:
        if sp['id'] in APP_ONLY_EXCLUDED:
            continue
        items.append({
            'id': sp['id'], 'category': sp['category'], 'icon': sp.get('iconSvg') or ICONS.get(sp.get('icon'), ICONS['tool']),
            'accepts': sp['accepts'], 'multiple': bool(sp.get('multiple')), 'minFiles': sp.get('minFiles', 1),
            'de': {k: sp['de'].get(k) for k in ('name', 'short', 'slug')} | {'keywords': sp['de'].get('keywords', [])},
            'en': {k: sp['en'].get(k) for k in ('name', 'short', 'slug')} | {'keywords': sp['en'].get('keywords', [])},
        })
    cats = [{'id': cid, 'de': labels['de'][1], 'en': labels['en'][1]} for cid, labels, _ in CATEGORIES]
    dump = lambda v: json.dumps(v, ensure_ascii=False, indent=1, sort_keys=True)
    return ('// GENERATED by network/tools/webtools/build.py from network/tools/webtools/specs/*.json – do not edit.\n'
            '// The FaleNetwork web tools as they appear in the app (js/webtools/host.js opens them in a frame).\n'
            f'export const WEB_TOOL_CATEGORIES = {dump(cats)};\n\n'
            f'export const WEB_TOOLS = {dump(items)};\n')


def write_app_files(specs, by_id):
    written = []
    keep = set()
    for lang in LANGS:
        for sp in specs:
            if sp['id'] in APP_ONLY_EXCLUDED:
                continue
            out = REPO / app_page_path(sp, lang).lstrip('/')
            keep.add(out)
            out.parent.mkdir(parents=True, exist_ok=True)
            content = page_app(sp, lang, by_id)
            if not out.exists() or out.read_text(encoding='utf-8') != content:
                out.write_text(content, encoding='utf-8')
            written.append(out)
    for lang in LANGS:   # pages of deleted tools
        d = APP_PAGES / lang
        for f in (d.glob('*.html') if d.is_dir() else []):
            if f not in keep:
                f.unlink()
    APP_CATALOG.parent.mkdir(parents=True, exist_ok=True)
    cat = app_catalog(specs)
    if not APP_CATALOG.exists() or APP_CATALOG.read_text(encoding='utf-8') != cat:
        APP_CATALOG.write_text(cat, encoding='utf-8')
    return written


def app_cta(lang):
    s = S[lang]
    return f'''<section class="section band wt-app-cta" aria-labelledby="app-h">
    <div class="wrap wt-app-cta-row">
      <img src="/assets/icons/app-pdf.svg" width="64" height="64" alt="">
      <div><h2 id="app-h">{s['app_h']}</h2><p>{s['app_p']}</p></div>
      <div class="btn-row">{bp.app_link(bp.PDF_APP, s['app_open'], 'btn btn-primary', lang)}<a class="btn btn-quiet" href="{bp.url('pdf', lang)}">{s['app_more']}</a></div>
    </div>
  </section>'''


# ------------------------------------------------------------------ hub page
POPULAR_MAX = 8   # keep the first screen short on phones

def page_hub(lang, specs):
    s = S[lang]
    items = [(s['home'], bp.url('home', lang)), (s['hub_name'], HUB[lang])]
    used = [cid for cid, _, _ in CATEGORIES if any(sp['category'] == cid for sp in specs)]
    chips = f'<li><a class="wt-cat" href="#alle" data-wt-cat="" aria-current="true">{s["all"]}</a></li>' + ''.join(
        f'<li><a class="wt-cat" href="#{CAT[cid][0][lang][0]}" data-wt-cat="{cid}">{CAT[cid][0][lang][1]}</a></li>' for cid in used)
    popular = ''.join(tool_card(sp, lang) for sp in [sp for sp in specs if sp.get('popular')][:POPULAR_MAX])
    sections = ''
    for cid in used:
        anchor, label, desc = CAT[cid][0][lang]
        cards = ''.join(tool_card(sp, lang) for sp in specs if sp['category'] == cid)
        sections += (f'<details class="wt-catsec wt-catacc" id="{anchor}" data-wt-catsec="{cid}">'
                     f'<summary><span class="wt-catacc-t"><span class="wt-catacc-name" id="cat-{cid}">{label}</span>'
                     f'<span class="wt-catacc-desc">{desc}</span></span><span class="wt-catacc-n">{sum(1 for sp in specs if sp["category"] == cid)}</span></summary>'
                     f'<ul class="wt-grid wt-rows">{cards}</ul></details>')
    about = ''.join(f'<li>{svg(UI_ICONS["check"])}<div><h3>{e(h)}</h3><p>{e(p)}</p></div></li>' for h, p in s['hub_about'])
    config = {'v': 1, 'lang': lang, 'hub': HUB[lang], 'tools': [
        {'id': sp['id'], 'name': sp[lang]['name'], 'url': tool_path(sp, lang), 'accepts': sp['accepts'],
         'multiple': bool(sp.get('multiple')), 'short': sp[lang].get('short') or sp[lang]['lede'],
         'colour': CAT[sp['category']][1], 'popular': bool(sp.get('popular'))} for sp in specs]}
    ld = [
        {'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': s['hub_h1'], 'url': BASE + HUB[lang],
         'description': s['hub_desc'], 'inLanguage': lang,
         'mainEntity': {'@type': 'ItemList', 'itemListElement': [
             {'@type': 'ListItem', 'position': i + 1, 'name': sp[lang]['name'], 'url': BASE + tool_path(sp, lang)}
             for i, sp in enumerate(specs)]}},
        ld_breadcrumb(items),
    ]
    h = bp.head(lang, 'home', s['hub_title'], s['hub_desc'], ld, paths=(HUB['de'], HUB['en']), og_image=OG_IMAGE[lang],
                og_alt=e(s['og_alt']), manifest=MANIFEST[lang], extra_head=extra_head(lang))
    hdr = bp.header(lang, 'home', current=HUB[lang], other_url=HUB['en' if lang == 'de' else 'de'])
    body = f'''
<main id="main" class="wt-page wt-hub">
  <div class="wrap wt-top">
    {crumbs(lang, [items[0], (items[1][0], None)])}
    <h1>{s['hub_h1']}</h1>
    <p class="wt-lede">{s['hub_lede']}</p>
    <section class="wt-shared" data-wt-shared hidden aria-labelledby="shared-h">
      <h2 id="shared-h">{s['shared_h']}</h2>
      <p class="wt-shared-files" data-wt-shared-files></p>
      <ul class="wt-grid" data-wt-shared-list></ul>
      <p class="wt-shared-none" data-wt-shared-none hidden>{s['shared_none']}</p>
    </section>
    <div class="wt-search" data-wt-search hidden>
      <label for="wt-q">{svg(UI_ICONS['search'])}<span class="sr-only">{s['search_label']}</span></label>
      <input id="wt-q" type="search" placeholder="{s['search_ph']}" autocomplete="off" enterkeyhint="search" data-wt-q>
    </div>
    <p class="wt-nohits" data-wt-nohits hidden role="status">{s['no_hits']}</p>
    <section class="wt-catsec wt-popular" id="alle" data-wt-popular aria-labelledby="pop-h">
      <div class="wt-catsec-head"><h2 id="pop-h">{s['popular']}</h2></div>
      <ul class="wt-grid wt-rows">{popular}</ul>
    </section>
    <section class="wt-cats-all" aria-labelledby="cats-h">
      <h2 id="cats-h" class="wt-cats-h">{s['by_topic']}</h2>
      {sections}
    </section>
    <p class="wt-live sr-only" data-wt-hublive aria-live="polite"></p>
  </div>
  {app_cta(lang)}
</main>
{json_script(config, 'wt-hub-config')}
<script type="module" src="/assets/wt/hub.js"></script>
'''
    return h + '\n' + hdr + body + bp.footer(lang)


def page_share_landing(lang):
    s = S[lang]
    h = bp.head(lang, 'home', s['share_title'], s['share_p'], noindex=True, paths=(SHARE_ACTION['de'], SHARE_ACTION['en']),
                og_image=OG_IMAGE[lang], og_alt=e(s['og_alt']), manifest=MANIFEST[lang], extra_head=extra_head(lang))
    h = '\n'.join(l for l in h.split('\n') if 'rel="canonical"' not in l and 'hreflang=' not in l and 'og:url' not in l)
    hdr = bp.header(lang, 'home', current=HUB[lang], other_url=SHARE_ACTION['en' if lang == 'de' else 'de'])
    body = f'''
<main id="main" class="wt-page">
  <div class="wrap wt-top">
    <h1>{s['share_h1']}</h1>
    <p class="wt-lede">{s['share_p']}</p>
    <p class="wt-share-back"><a class="btn btn-primary" href="{HUB[lang]}">{s['share_link']}</a></p>
  </div>
</main>
'''
    return h + '\n' + hdr + body + bp.footer(lang)


def manifest(lang):
    s = S[lang]
    accept = sorted({a for a in ['application/pdf', '.pdf', 'image/*', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif']})
    return {
        'id': HUB[lang], 'name': s['app_name'], 'short_name': s['app_short'], 'description': s['app_desc'],
        'lang': lang, 'dir': 'ltr', 'start_url': HUB[lang], 'scope': '/', 'display': 'standalone',
        'background_color': '#F2F3F9', 'theme_color': '#171542',
        'icons': [
            {'src': '/assets/icons/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
            {'src': '/assets/icons/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
            {'src': '/assets/icons/icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
        ],
        'share_target': {
            'action': SHARE_ACTION[lang], 'method': 'POST', 'enctype': 'multipart/form-data',
            'params': {'title': 'title', 'text': 'text', 'files': [{'name': 'files', 'accept': accept}]},
        },
    }


# ------------------------------------------------------------------ module graph (offline warm-up)
_IMPORT_RE = re.compile(r'''(?:^|[;\s])import\s[^'"]*?from\s*['"](\.{1,2}/[^'"]+\.js)['"]|import\(\s*['"](\.{1,2}/[^'"]+\.js)['"]\s*\)|^\s*import\s*['"](\.{1,2}/[^'"]+\.js)['"]''', re.M)
_graph_cache = {}


def module_graph(module):
    """All local modules a tool can load – static AND dynamic imports (import('…')) – as site paths, so the shell can
    cache them on the first visit and the tool also works offline when a step loads code only while running."""
    if module in _graph_cache:
        return _graph_cache[module]
    seen, todo = set(), [WT / module]
    while todo:
        f = todo.pop()
        if f in seen or not f.exists() or 'vendor' in f.relative_to(WT).parts:
            continue
        seen.add(f)
        for m in _IMPORT_RE.finditer(f.read_text(encoding='utf-8')):
            rel = next(g for g in m.groups() if g)
            todo.append((f.parent / rel).resolve())
    out = sorted('/' + str(p.relative_to(ROOT)).replace('\\', '/') for p in seen)
    _graph_cache[module] = out
    return out


# ------------------------------------------------------------------ service worker
def file_hash(paths):
    h = hashlib.sha256()
    for p in paths:
        h.update(str(p.relative_to(ROOT)).encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def service_worker():
    core_files = sorted(p for p in WT.rglob('*') if p.is_file() and 'vendor' not in p.relative_to(WT).parts
                        and p.relative_to(WT).parts[0] not in ('tools',) and p.relative_to(WT).parts[:2] != ('lib', 'shared'))
    site = [ROOT / 'assets/fale-tokens.css', ROOT / 'assets/site.css', ROOT / 'assets/site.js',
            ROOT / 'assets/logo/fale-network-mark.svg', ROOT / 'favicon.svg', ROOT / 'assets/icons/app-pdf.svg',
            WT / 'vendor/fonts/BricolageGrotesque-Bold.woff']
    precache = ['/' + str(p.relative_to(ROOT)).replace('\\', '/') for p in core_files + site] + [HUB['de'], HUB['en']]
    all_wt = sorted(p for p in WT.rglob('*') if p.is_file())
    hubs = [ROOT / 'werkzeuge/index.html', ROOT / 'en/tools/index.html']
    version = file_hash(all_wt + site + hubs)[:12]
    vendor_ver = file_hash([WT / 'vendor/MANIFEST.json'])[:12] if (WT / 'vendor/MANIFEST.json').exists() else 'none'
    tpl = (HERE / 'sw.template.js').read_text(encoding='utf-8')
    out = (tpl.replace('__VERSION__', version).replace('__VENDOR_VERSION__', vendor_ver)
           .replace('__PRECACHE__', json.dumps(precache, indent=2))
           .replace('__SHARE__', json.dumps({SHARE_ACTION[l]: SHARE_LANDING[l] for l in LANGS}))
           .replace('__SCOPES__', json.dumps([HUB['de'], HUB['en'], *VORLAGEN_SCOPES]))
           .replace('__HUBS__', json.dumps(HUB)))
    return out, version


# ------------------------------------------------------------------ sitemap merge
def merge_sitemap(entries):
    """entries: list of (de_path, en_path). Keeps every existing <url> whose loc is not regenerated here."""
    sm = ROOT / 'sitemap.xml'
    text = sm.read_text(encoding='utf-8') if sm.exists() else ''
    ours = set()
    new = []
    for de, en in entries:
        alts = (f'<xhtml:link rel="alternate" hreflang="de" href="{BASE}{de}"/>'
                f'<xhtml:link rel="alternate" hreflang="en" href="{BASE}{en}"/>'
                f'<xhtml:link rel="alternate" hreflang="x-default" href="{BASE}{de}"/>')
        for loc in (de, en):
            ours.add(BASE + loc)
            new.append(f'  <url><loc>{BASE}{loc}</loc>{alts}</url>')
    keep = []
    for m in re.finditer(r'^\s*<url>.*?</url>\s*$', text, re.M | re.S):
        block = m.group(0).strip('\n')
        loc = re.search(r'<loc>(.*?)</loc>', block)
        if loc and loc.group(1) in ours:
            continue
        # drop tool URLs whose spec no longer exists (anything under the two hubs)
        if loc and (loc.group(1).startswith(BASE + HUB['de']) or loc.group(1).startswith(BASE + HUB['en'])):
            continue
        keep.append(block)
    out = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
           + '\n'.join(keep + new) + '\n</urlset>\n')
    sm.write_text(out, encoding='utf-8')


def write(path, content):
    out = ROOT / path.lstrip('/')
    if path.endswith('/'):
        out = out / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists() or out.read_text(encoding='utf-8') != content:
        out.write_text(content, encoding='utf-8')
    return out


def main():
    try:
        specs = load_specs()
    except SpecError as ex:
        print('Spec errors:\n' + str(ex), file=sys.stderr)
        sys.exit(1)
    by_id = {sp['id']: sp for sp in specs}
    written = []
    # remove generated tool pages whose spec was deleted or renamed
    for lang in LANGS:
        hub_dir = ROOT / HUB[lang].strip('/')
        keep = {sp[lang]['slug'] for sp in specs} | {SHARE_ACTION[lang].strip('/').split('/')[-1]}
        if hub_dir.is_dir():
            for d in hub_dir.iterdir():
                if d.is_dir() and d.name not in keep and (d / 'index.html').exists() and 'wt-config' in (d / 'index.html').read_text(encoding='utf-8'):
                    (d / 'index.html').unlink()
                    try:
                        d.rmdir()
                    except OSError:
                        pass
    for lang in LANGS:
        written.append(write(HUB[lang], page_hub(lang, specs)))
        written.append(write(SHARE_ACTION[lang], page_share_landing(lang)))
        written.append(write(MANIFEST[lang], json.dumps(manifest(lang), ensure_ascii=False, indent=2) + '\n'))
        for sp in specs:
            written.append(write(tool_path(sp, lang), page_tool(sp, lang, by_id)))
    sw, version = service_worker()
    written.append(write('/sw.js', sw))
    app_files = write_app_files(specs, by_id)
    print(f'FaLe PDF app: {len(app_files)} tool pages in wt-app/, catalog js/webtools/catalog.js')
    merge_sitemap([(HUB['de'], HUB['en'])] + [(tool_path(sp, 'de'), tool_path(sp, 'en')) for sp in specs])
    for p in written:
        print(p.relative_to(ROOT), p.stat().st_size, 'bytes')
    print(f'{len(specs)} tools, service worker version {version}')
    # FaLe Vorlagen-Archiv (job application templates, ../vorlagen/build.py): same chrome, merged into the sitemap
    vb = HERE.parent / 'vorlagen' / 'build.py'
    if vb.exists():
        import importlib.util
        spec = importlib.util.spec_from_file_location('vorlagen_build', vb)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.main(sys.modules[__name__])


if __name__ == '__main__':
    main()
