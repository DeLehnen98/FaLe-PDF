#!/usr/bin/env python3
"""FaLe Vorlagen-Archiv – generator for the job application template pages.

Data (one JSON file per job, see README.md in this folder):
    data/<berufsfeld>/<id>.json   job: intro, 2–3 cover letters, example CV (+ optional "en" block)
    data/ratgeber/<id>.json       guide pages (Initiativbewerbung, Bewerbung per E-Mail …)

Output (deterministic, run twice → no diff):
    /vorlagen/                         archive hub (DE)          ↔ /en/templates/ (EN hub)
    /vorlagen/bewerbung/               job directory: search + filters
    /vorlagen/bewerbung/<slug>/        one page per job          ↔ /en/templates/<slug>/ where an EN version exists
    /vorlagen/ratgeber/<slug>/         guides
    /vorlagen/data/<id>.json           prefill data for the CV builder / cover letter tools (?vorlage=<id>)
    sitemap.xml                        merged (only the URLs of this archive are replaced)

Uses the chrome, head and helpers of ../build_pages.py and ../webtools/build.py. It is called at the end of
webtools/build.py, so the usual `python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py`
regenerates everything. Rendered images (avatar PNGs, CV previews) come from make_assets.py (Playwright, by hand).
"""
import json
import re
import shutil
import sys
sys.dont_write_bytecode = True  # no __pycache__ inside the deployed folder
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
sys.path.insert(0, str(HERE))
from avatars import AVATARS, avatar_svg  # noqa: E402

HUB = {'de': '/vorlagen/', 'en': '/en/templates/'}
SECTION = '/vorlagen/bewerbung/'
GUIDES = '/vorlagen/ratgeber/'
DATA_URL = '/vorlagen/data/'
IMG = '/assets/vorlagen/'
LANGS = ('de', 'en')
SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
MARK = 'data-vl-page'
LAX = '--lax' in sys.argv
THUMB_W, THUMB_H = 480, 679

# Berufsfelder: id, DE label, EN label, colour class (wt.css tic-*), icon (24px stroke paths)
FIELDS = [
    ('pflege', 'Pflege & Gesundheit', 'Healthcare', 'secure', '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M12 9v5M9.5 11.5h5"/>'),
    ('soziales', 'Erziehung & Soziales', 'Education & social work', 'share', '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.6-3.4 2.6-5.5 5-5.5s4.4 2.1 5 5.5M13.5 20c.4-2.6 1.8-4.2 3.5-4.2s3.1 1.6 3.5 4.2"/>'),
    ('handwerk', 'Handwerk & Technik', 'Skilled trades', 'ai', '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-1.9-1.9z"/><path d="M4 4l4 4"/>'),
    ('buero', 'Büro & Verwaltung', 'Office & administration', 'organize', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    ('handel', 'Handel & Verkauf', 'Retail & sales', 'convert', '<path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
    ('logistik', 'Logistik & Verkehr', 'Logistics & transport', 'read', '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
    ('gastro', 'Gastronomie & Hotel', 'Hospitality', 'edit', '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 21V3c-2 1.5-3 4-3 7h3"/>'),
    ('it', 'IT & Digital', 'IT & digital', 'scan', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M9 9l-2 1.5L9 12M15 9l2 1.5-2 1.5"/>'),
    ('industrie', 'Industrie & Produktion', 'Manufacturing', 'ai', '<path d="M3 20V10l5 3V10l5 3V6h4v14z"/><path d="M3 20h18"/>'),
    ('oeffentlich', 'Öffentlicher Dienst', 'Public sector', 'organize', '<path d="M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18"/>'),
    ('marketing', 'Marketing & Medien', 'Marketing & media', 'convert', '<path d="M4 10v4l11 5V5z"/><path d="M15 9a3 3 0 0 1 0 6M7 14l1.5 5h2.5l-1-4.2"/>'),
    ('finanzen', 'Finanzen & Recht', 'Finance & law', 'read', '<path d="M12 3v18M7 7h10M4 7l-2 6a3 3 0 0 0 4 0zM20 7l-2 6a3 3 0 0 0 4 0zM8 21h8"/>'),
    ('ausbildung', 'Ausbildung & Schüler', 'Apprenticeships & school leavers', 'share', '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>'),
    ('praktikum', 'Praktikum & Werkstudent', 'Internships & student jobs', 'edit', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 12h18"/>'),
    ('minijob', 'Minijob & Aushilfe', 'Part-time & side jobs', 'scan', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'),
]
FIELD = {f[0]: f for f in FIELDS}
LEVELS = [
    ('ausbildung', 'Ausbildung', 'Apprenticeship'),
    ('berufseinstieg', 'Berufseinstieg', 'Entry level'),
    ('erfahren', 'Mit Erfahrung', 'Experienced'),
    ('quereinstieg', 'Quereinstieg', 'Career change'),
    ('minijob', 'Minijob / Aushilfe', 'Part-time'),
    ('praktikum', 'Praktikum', 'Internship'),
    ('initiativ', 'Initiativbewerbung', 'Speculative'),
]
LEVEL = {lv[0]: lv for lv in LEVELS}
DESIGNS = {'classic': ('Klassisch', 'Classic'), 'modern': ('Modern', 'Modern'), 'compact': ('Kompakt', 'Compact'),
           # more designs of lib/tpl-cv.js (lib/arc2-cvdesigns.js)
           'elegant': ('Elegant', 'Elegant'), 'timeline': ('Zeitstrahl', 'Timeline'), 'minimal': ('Minimal', 'Minimal'), 'creative': ('Kreativ', 'Creative'),
           'ats': ('ATS-freundlich', 'ATS-friendly'), 'academic': ('Akademisch', 'Academic'), 'school': ('Schule & Ausbildung', 'School leaver')}
ACCENTS = ['#2b59c3', '#0f766e', '#7c3aed', '#b91c1c', '#c2410c', '#334155']   # = lib/tpl-cv.js ACCENTS
CV_SECTIONS = ['exp', 'edu', 'courses', 'skills', 'langs', 'hobbies']           # = lib/tpl-cv.js SECTION_IDS
LANG_LEVEL_KEYS = ('native', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1')
LANG_LEVEL_LABEL = {
    'de': {'native': 'Muttersprache', 'C2': 'C2 – nahezu muttersprachlich', 'C1': 'C1 – fließend', 'B2': 'B2 – sehr gut', 'B1': 'B1 – gut', 'A2': 'A2 – Grundkenntnisse', 'A1': 'A1 – Anfänger'},
    'en': {'native': 'Native', 'C2': 'C2 – proficient', 'C1': 'C1 – advanced', 'B2': 'B2 – upper intermediate', 'B1': 'B1 – intermediate', 'A2': 'A2 – elementary', 'A1': 'A1 – beginner'},
}
MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

# --------------------------------------------------------------------------------------------- texts
S = {
    'de': {
        'home': 'Start', 'hub': 'Vorlagen', 'section': 'Bewerbung', 'guides': 'Ratgeber',
        'hub_title': 'Vorlagen: Bewerbung, Lebenslauf, Briefe & Tabellen | FaleNetwork',
        'hub_desc': 'Kostenlose Vorlagen: Bewerbungen für über {n} Berufe, Lebenslauf-Designs, Briefvorlagen und Excel-Tabellen – im Browser ausfüllen und als PDF speichern.',
        'hub_h1': 'Vorlagen',
        'hub_lede': 'Bewerbung, Lebenslauf, Briefe und Tabellen: Beispiel öffnen, eigene Daten eintragen, als PDF speichern.',
        'hub_search_label': 'Bewerbungsvorlage nach Beruf suchen', 'hub_search_ph': 'Beruf suchen, z. B. Pflege, Verkauf …', 'hub_search_btn': 'Suchen',
        'hub_coll_label': 'Bereiche', 'hub_apps_m': '{n} Berufe mit Anschreiben', 'hub_fill_h': 'Zum Ausfüllen', 'hub_fill_m': '{n} Formulare, z. B. Kündigung',
        'hub_guides_m': '{n} Ratgeber zur Bewerbung', 'hub_pop_all': 'Alle {n} Berufe ansehen',
        'hub_apps_h': 'Bewerbung & Lebenslauf', 'hub_apps_p': '{n} Berufe aus {f} Berufsfeldern – vom Minijob bis zur Fachkraft mit Berufserfahrung.',
        'hub_apps_btn': 'Alle Bewerbungsvorlagen', 'hub_pop_h': 'Häufig gesucht', 'hub_guides_h': 'Ratgeber',
        'hub_more_h': 'Formulare zum Ausfüllen', 'hub_more_p': 'Ausfüllen, Vorschau ansehen, als PDF speichern.',
        'hub_how_h': 'So nutzt du die Vorlagen',
        'hub_how': [('Beruf wählen', 'Such deinen Beruf oder filtere nach Berufsfeld und Situation – Ausbildung, Berufseinstieg, Quereinstieg und mehr.'),
                    ('Beispiel öffnen', '„Vorlage verwenden“ öffnet den Lebenslauf oder das Anschreiben fertig ausgefüllt im Editor.'),
                    ('Eigene Daten einsetzen', 'Zuerst dein Foto (oder keins), dann Namen, Stationen und Text anpassen. Das PDF entsteht auf deinem Gerät.')],
        'sec_title': 'Bewerbungsvorlagen nach Beruf – Muster & Lebenslauf | FaleNetwork',
        'sec_desc': 'Bewerbungsmuster für {n} Berufe: Anschreiben für Ausbildung, Berufseinstieg, Quereinstieg und Minijob, dazu Lebensläufe mit Foto-Platzhalter – kostenlos.',
        'sec_h1': 'Bewerbungsvorlagen nach Beruf',
        'sec_lede': 'Für jeden Beruf zwei bis drei echte Anschreiben-Beispiele für unterschiedliche Situationen und einen fertigen Lebenslauf, den du direkt übernehmen kannst.',
        'search_label': 'Beruf suchen', 'search_ph': 'Beruf suchen, z. B. Pflege, Kasse, LKW …',
        'filter_field': 'Berufsfeld', 'filter_level': 'Situation', 'all': 'Alle', 'no_hits': 'Kein Beruf gefunden. Probier einen anderen Begriff – oder schau in ein verwandtes Berufsfeld.',
        'hits': '{n} Berufe', 'hit1': '1 Beruf', 'letters_n': '{n} Anschreiben', 'cv': 'Lebenslauf',
        'job_title': 'Bewerbung als {name}: Muster & Lebenslauf | FaleNetwork',
        'job_title_short': 'Bewerbung {name}: Muster | FaleNetwork',
        'job_h1': 'Bewerbung als {name}',
        'job_lede': '{n} ausformulierte Anschreiben, ein fertiger Lebenslauf mit Foto-Platzhalter und Tipps – öffne das Beispiel und ersetze die Daten durch deine.',
        'use_cv': 'Lebenslauf-Vorlage verwenden', 'use_letter': 'Dieses Anschreiben verwenden', 'use_letters': 'Anschreiben verwenden',
        'start_h': 'In drei Schritten zu deiner Bewerbung',
        'start': [('Eigenes Foto einsetzen', 'Das Beispiel hat ein gezeichnetes Platzhalter-Porträt. Tausch es im Editor unter „Foto wählen“ gegen dein Foto – oder entferne es, ein Foto ist freiwillig.'),
                  ('Daten ersetzen', 'Name, Anschrift, Stationen, Kenntnisse: alles ist ausgefüllt und lässt sich Feld für Feld überschreiben.'),
                  ('Als PDF speichern', 'Das PDF entsteht in deinem Browser. Nichts wird hochgeladen, kein Konto nötig.')],
        'look_h': 'Darauf achten Arbeitgeber', 'letters_h': 'Anschreiben-Muster', 'letters_p': 'Jedes Beispiel ist für eine andere Ausgangslage geschrieben. Übernimm den Aufbau, nicht die Sätze: Deine eigenen Erlebnisse und Zahlen machen den Unterschied.',
        'cv_h': 'Lebenslauf-Muster', 'cv_p': 'Ein vollständiger tabellarischer Lebenslauf passend zum Beruf – mit illustriertem Platzhalter statt Foto.',
        'cv_photo_hint': 'Platzhalter-Porträt: im Editor durch dein Foto ersetzen oder entfernen.',
        'cv_preview_alt': 'Vorschau des Lebenslaufs von {name} im Design {design}', 'cv_open': 'Im Editor öffnen und anpassen',
        'exp': 'Berufserfahrung', 'edu': 'Ausbildung', 'courses': 'Weiterbildung', 'skills': 'Kenntnisse', 'langs': 'Sprachen', 'hobbies': 'Interessen', 'today': 'heute', 'since': 'seit',
        'tips_h': 'Tipps für deine Bewerbung', 'do': 'Das hilft', 'dont': 'Lieber nicht',
        'q_h': 'Typische Fragen im Vorstellungsgespräch', 'q_p': 'Bereite zu jeder Frage ein kurzes, ehrliches Beispiel aus deinem Alltag vor.',
        'pay_h': 'Gehaltsvorstellung', 'pay_generic': 'Fragt die Anzeige nach deiner Gehaltsvorstellung, nenn eine Jahres-Bruttosumme oder eine Spanne, die du vorher recherchiert hast – etwa über Tarifverträge, den Entgeltatlas der Bundesagentur für Arbeit oder Gespräche mit Leuten aus dem Beruf. Steht nichts in der Anzeige, lass das Thema im Anschreiben weg; im Gespräch kommt es ohnehin.',
        'faq_h': 'Häufige Fragen', 'related_h': 'Verwandte Berufe', 'tools_h': 'Bewerbungsmappe fertig machen',
        'tools_p': 'Anschreiben und Lebenslauf als PDF, Zeugnisse dazu, alles in eine Datei – und klein genug fürs Bewerbungsportal.',
        'copy': 'Text kopieren', 'copied': 'Kopiert', 'paper_label': 'Anschreiben-Beispiel', 'date_ph': 'TT. Monat JJJJ',
        'subject': 'Bewerbung als {p}', 'subject_ref': ' – Kennziffer {r}', 'closing': 'Mit freundlichen Grüßen', 'att': 'Anlagen',
        'sal_f': 'Sehr geehrte Frau {c},', 'sal_m': 'Sehr geehrter Herr {c},', 'sal_n': 'Guten Tag {c},', 'sal_none': 'Sehr geehrte Damen und Herren,',
        'to_f': 'Frau {c}', 'to_m': 'Herrn {c}',
        'level_label': 'Situation', 'example_note': 'Alle Personen, Firmen und Kontaktdaten in den Beispielen sind erfunden.',
        'faq_photo': ('Muss ich ein Bewerbungsfoto mitschicken?', 'Nein. Seit dem Allgemeinen Gleichbehandlungsgesetz (AGG) dürfen Arbeitgeber in Deutschland kein Foto verlangen, und eine Bewerbung ohne Foto ist vollständig. Wenn du eins verwendest: aktuell, freundlich, ruhiger Hintergrund, Kleidung wie im Job an einem guten Tag – ein Fotostudio oder eine gut belichtete Handyaufnahme am Fenster reichen. Im Editor kannst du das Foto rund oder rechteckig zuschneiden.'),
        'faq_copy': ('Darf ich die Beispieltexte einfach übernehmen?', 'Ja, sie sind frei verwendbar. Personalverantwortliche lesen aber viele Bewerbungen – ein Text mit deinen eigenen Beispielen, Zahlen und deinem Grund für genau diese Firma wirkt immer stärker als ein übernommener. Nimm die Muster als Gerüst und schreib die Sätze neu.'),
        'faq_privacy': ('Werden meine Daten gespeichert?', 'Nein. Lebenslauf und Anschreiben entstehen in deinem Browser. Gespeichert wird nur, wenn du im Editor „Entwurf speichern“ einschaltest – und auch dann nur auf deinem Gerät.'),
        'guide_more_h': 'Mehr aus dem Ratgeber', 'hub_faq': None,
        'kuendigung': ('Kündigung schreiben', 'Neue Stelle sicher? Die Kündigung als Arbeitnehmer mit Frist-Rechner.'),
        'og_alt': 'FaleNetwork Vorlagen – Bewerbungsvorlagen nach Beruf',
    },
    'en': {
        'home': 'Home', 'hub': 'Templates',
        'hub_title': 'Templates: CVs, cover letters, letters & spreadsheets | FaleNetwork',
        'hub_desc': 'Free CV and cover letter examples for {n} common jobs: fully written letters, a ready CV with a placeholder portrait and tips – edit and save as PDF.',
        'hub_h1': 'Templates',
        'hub_lede': 'CVs, cover letters, letters and spreadsheets: open an example, swap in your details, save it as a PDF.',
        'hub_coll_label': 'Sections', 'hub_apps_h': 'CV & cover letter', 'hub_apps_m': '{n} jobs, fully written', 'hub_fill_h': 'Fill-in forms', 'hub_fill_m': '{n} forms, e.g. invoice',
        'hub_jobs_h': 'CV and cover letter by job', 'hub_more_h': 'Forms to fill in', 'hub_more_p': 'Fill in, check the preview, save the PDF.',
        'hub_how_h': 'How to use the templates',
        'hub_how': [('Pick a job', 'Choose the job that is closest to yours – the structure works for related roles too.'),
                    ('Open the example', '“Use this template” opens the CV or the cover letter fully filled in, in the editor.'),
                    ('Make it yours', 'Start with your photo (or none), then replace names, jobs and text. The PDF is created on your device.')],
        'search_label': 'Search jobs', 'search_ph': 'Search jobs, e.g. nurse, developer …',
        'no_hits': 'No job found. Try another word.', 'hits': '{n} jobs', 'hit1': '1 job', 'all': 'All',
        'letters_n': '{n} cover letters', 'cv': 'CV',
        'job_title': '{name} CV & cover letter examples | FaleNetwork',
        'job_title_short': '{name} CV & cover letter | FaleNetwork',
        'job_h1': '{name}: CV and cover letter examples',
        'job_lede': '{n} fully written cover letters, a ready CV with a placeholder portrait and practical tips – open the example and replace the details with yours.',
        'use_cv': 'Use this CV template', 'use_letter': 'Use this cover letter', 'use_letters': 'Use a cover letter',
        'start_h': 'Your application in three steps',
        'start': [('Add your own photo – or none', 'The example uses an illustrated placeholder. Replace it under “Choose photo” in the editor, or remove it: in the UK, US and many other countries a CV photo is not expected.'),
                  ('Replace the details', 'Name, contact, jobs, skills: everything is filled in and can be overwritten field by field.'),
                  ('Save as PDF', 'The PDF is created in your browser. Nothing is uploaded, no account needed.')],
        'look_h': 'What employers look for', 'letters_h': 'Cover letter examples', 'letters_p': 'Each example is written for a different starting point. Borrow the structure, not the sentences – your own examples and numbers are what make a letter work.',
        'cv_h': 'CV example', 'cv_p': 'A complete CV for the role – with an illustrated placeholder instead of a photo.',
        'cv_photo_hint': 'Placeholder portrait: replace it with your photo in the editor, or remove it.',
        'cv_preview_alt': 'Preview of the CV of {name} in the {design} design', 'cv_open': 'Open in the editor',
        'exp': 'Work experience', 'edu': 'Education', 'courses': 'Training', 'skills': 'Skills', 'langs': 'Languages', 'hobbies': 'Interests', 'today': 'present', 'since': 'since',
        'tips_h': 'Tips for your application', 'do': 'Do', 'dont': 'Don’t',
        'q_h': 'Typical interview questions', 'q_p': 'Prepare a short, honest example from your own work for each one.',
        'pay_h': 'Salary expectations', 'pay_generic': 'If the advert asks for your salary expectations, give an annual gross figure or a range you have researched – through pay scales, salary surveys from public sources or people who do the job. If it does not ask, leave pay out of the letter; it will come up in the interview.',
        'faq_h': 'Frequently asked questions', 'related_h': 'Related jobs', 'tools_h': 'Finish your application',
        'tools_p': 'Cover letter and CV as PDF, certificates added, all in one file – small enough for any job portal.',
        'copy': 'Copy text', 'copied': 'Copied', 'paper_label': 'Cover letter example', 'date_ph': 'DD Month YYYY',
        'subject': 'Application for the position of {p}', 'subject_ref': ' – reference {r}', 'closing_named': 'Yours sincerely,', 'closing_anon': 'Yours faithfully,', 'att': 'Enclosures',
        'sal_f': 'Dear Ms {c},', 'sal_m': 'Dear Mr {c},', 'sal_n': 'Dear {c},', 'sal_none': 'Dear Sir or Madam,',
        'to_f': '{c}', 'to_m': '{c}',
        'example_note': 'All people, companies and contact details in the examples are fictional.',
        'faq_photo': ('Should I put a photo on my CV?', 'It depends on the country. In the UK, Ireland and the US a photo is usually left out to avoid bias, and many employers prefer CVs without one. In Germany and some other countries it is common but optional. If you use one: recent, friendly, plain background, dressed as you would be on a good day at work.'),
        'faq_copy': ('Can I copy the example letters?', 'Yes, they are free to use. But recruiters read a lot of letters – one with your own examples, numbers and a real reason for choosing this employer will always do better. Use the examples as scaffolding and write the sentences yourself.'),
        'faq_privacy': ('Is my data stored anywhere?', 'No. The CV and the letter are created in your browser. Nothing is stored unless you switch on “Save the draft” in the editor – and then only on your device.'),
        'og_alt': 'FaLe templates – CV and cover letter examples',
    },
}


class DataError(Exception):
    pass


# Extra sections of the archive, built by modules in this folder: build(wb, bp, vb, jobs, wb_specs) →
# {'written', 'entries' (sitemap), 'data' ({file name: text} for /vorlagen/data/), 'hub' (lang → html for the hub), 'summary'}
EXTENSIONS = ('arc2_sections',)   # Excel-/Tabellen-Vorlagen, Briefvorlagen, Lebenslauf-Design-Galerie
HUB_EXTRA = []                    # filled by main(): lang → [(href, title, count line, icon kind)] tiles on the hub


def run_extensions(wb, bp, jobs, wb_specs, standalone):
    import importlib
    out = []
    for name in EXTENSIONS:
        try:
            mod = importlib.import_module(name)
            this = sys.modules.get(__name__) or __import__('types').SimpleNamespace(**globals())  # loaded via importlib by webtools/build.py
            out.append(mod.build(wb, bp, this, jobs, wb_specs))
        except DataError as ex:
            print(f'Vorlagen extension {name}: data errors:\n{ex}', file=sys.stderr)
            if standalone:
                sys.exit(1)
    return out


# --------------------------------------------------------------------------------------------- helpers
def wb_module():
    sys.path.insert(0, str(HERE.parent / 'webtools'))
    import build as wb  # noqa: E402
    return wb


def fold(text):
    t = text.lower()
    for a, b in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss'), ('é', 'e'), ('è', 'e'), ('á', 'a'), ('ó', 'o'), ('ç', 'c'), ('ł', 'l'), ('ş', 's'), ('ğ', 'g'), ('ı', 'i')):
        t = t.replace(a, b)
    return t


def email_for(name):
    parts = [re.sub(r'[^a-z]', '', fold(p)) for p in name.split() if not p.endswith('.')]
    parts = [p for p in parts if p]
    return f'{parts[0]}.{parts[-1]}@example.com' if len(parts) > 1 else f'{parts[0]}@example.com'


def phone_for(key):
    """Fictional numbers from the ranges the Bundesnetzagentur keeps free for film/TV (e.g. 030 23125 xxx)."""
    h = sum((i + 1) * ord(c) for i, c in enumerate(key))
    pre = ['030 23125', '040 66969', '069 90009', '089 99998', '0221 4710'][h % 5]
    return f'{pre} {h % 1000:03d}'


def job_path(job, lang):
    return f"{SECTION}{job['slug']}/" if lang == 'de' else f"{HUB['en']}{job['en']['slug']}/"


def guide_path(g):
    return f"{GUIDES}{g['slug']}/"


def fmt(s, **kw):
    return s.format(**kw)


# --------------------------------------------------------------------------------------------- load + validate
REQ_JOB = ['id', 'field', 'name', 'short', 'desc', 'intro', 'lookFor', 'letters', 'cv', 'do', 'dont', 'questions', 'faq', 'related']
REQ_LETTER = ['label', 'level', 'position', 'to', 'body', 'att']
REQ_CV = ['avatar', 'name', 'title', 'street', 'city', 'exp', 'edu', 'skills', 'langs']


def check_letter(where, L, errors):
    for k in REQ_LETTER:
        if k not in L:
            errors.append(f'{where}: letter field "{k}" missing')
    if L.get('level') not in LEVEL:
        errors.append(f'{where}: unknown level {L.get("level")!r}')
    if not 2 <= len(L.get('body', [])) <= 4:
        errors.append(f'{where}: body needs 2–4 paragraphs (the cover letter tool has four)')
    to = L.get('to', {})
    if not to.get('org') or to.get('sal', 'none') not in ('f', 'm', 'n', 'none') or (to.get('sal', 'none') != 'none' and not to.get('contact')):
        errors.append(f'{where}: "to" needs org, sal f/m/n/none and contact unless sal is none')
    if 'from' in L and len(L['from']) != 3:
        errors.append(f'{where}: "from" = [name, street, "PLZ Ort"]')


def check_cv(where, cv, errors):
    for k in REQ_CV:
        if k not in cv:
            errors.append(f'{where}: cv field "{k}" missing')
    if cv.get('avatar') not in AVATARS and cv.get('avatar') is not None:
        errors.append(f'{where}: unknown avatar {cv.get("avatar")!r}')
    for sec in ('exp', 'edu', 'courses'):
        for row in cv.get(sec, []):
            if len(row) != 6:
                errors.append(f'{where}: cv.{sec} rows are [from, to, role, org, place, desc]')
    for row in cv.get('skills', []):
        if len(row) != 2 or not isinstance(row[1], int) or not 0 <= row[1] <= 5:
            errors.append(f'{where}: cv.skills rows are [name, 0–5]')
    for row in cv.get('langs', []):
        if len(row) != 2 or row[1] not in LANG_LEVEL_KEYS:
            errors.append(f'{where}: cv.langs rows are [name, native|C2…A1]')
    if cv.get('design', 'modern') not in DESIGNS or not 0 <= cv.get('accent', 0) < len(ACCENTS):
        errors.append(f'{where}: bad design/accent')


def load(wb):
    errors, jobs, guides = [], [], []
    for f in sorted(DATA.glob('*/*.json')):
        try:
            d = json.loads(f.read_text(encoding='utf-8'))
        except Exception as ex:  # noqa: BLE001
            errors.append(f'{f}: {ex}')
            continue
        rel = f.relative_to(DATA)
        if rel.parts[0] == 'ratgeber':
            d.setdefault('slug', d.get('id'))
            for k in ('id', 'title', 'h1', 'desc', 'lede', 'sections', 'faq'):
                if k not in d:
                    errors.append(f'{rel}: field "{k}" missing')
            guides.append(d)
            continue
        if d.get('id') != f.stem:
            errors.append(f'{rel}: id must equal the file name')
        if d.get('field') != rel.parts[0] or rel.parts[0] not in FIELD:
            errors.append(f'{rel}: field must equal the folder (one of {", ".join(FIELD)})')
        for k in REQ_JOB:
            if k not in d:
                errors.append(f'{rel}: field "{k}" missing')
        if errors and errors[-1].startswith(str(rel)):
            continue
        d.setdefault('slug', d['id'])
        if not SLUG_RE.match(d['slug']):
            errors.append(f'{rel}: bad slug')
        if not 2 <= len(d['letters']) <= 3:
            errors.append(f'{rel}: 2–3 letters')
        for i, L in enumerate(d['letters']):
            check_letter(f'{rel} letter {i + 1}', L, errors)
            if i and 'from' not in L:
                errors.append(f'{rel} letter {i + 1}: "from" missing (letter 1 is written by the CV person)')
        check_cv(f'{rel}', d['cv'], errors)
        if not 110 <= len(d['desc']) <= 180:
            errors.append(f'{rel}: desc length {len(d["desc"])} (110–180)')
        if 'en' in d:
            en = d['en']
            for k in ('slug', 'name', 'short', 'desc', 'intro', 'lookFor', 'letters', 'cv', 'do', 'dont', 'questions', 'faq'):
                if k not in en:
                    errors.append(f'{rel}: en.{k} missing')
            for i, L in enumerate(en.get('letters', [])):
                check_letter(f'{rel} en letter {i + 1}', L, errors)
            check_cv(f'{rel} en', en.get('cv', {}), errors)
        blob = json.dumps(d, ensure_ascii=False)
        m = wb.BANNED.search(blob)
        if m:
            errors.append(f'{rel}: brand name "{m.group(0)}"')
        jobs.append(d)
    ids = [j['id'] for j in jobs]
    slugs = [j['slug'] for j in jobs] + [g['slug'] for g in guides]
    if len(set(ids)) != len(ids) or len(set(slugs)) != len(slugs):
        errors.append('duplicate job ids or slugs')
    en_slugs = [j['en']['slug'] for j in jobs if 'en' in j]
    if len(set(en_slugs)) != len(en_slugs):
        errors.append('duplicate EN slugs')
    by_id = {j['id']: j for j in jobs}
    for j in jobs:
        for r in j['related']:
            if r not in by_id:
                if LAX:  # draft mode while writing new jobs: python3 build.py --lax
                    print(f'warning: {j["id"]}: related "{r}" does not exist', file=sys.stderr)
                else:
                    errors.append(f'{j["id"]}: related "{r}" does not exist')
        j['related'] = [r for r in j['related'] if r in by_id]
    if errors:
        raise DataError('\n'.join(errors))
    for j in jobs:
        j['levels'] = sorted({L['level'] for L in j['letters']}, key=[lv[0] for lv in LEVELS].index)
    jobs.sort(key=lambda j: (FIELD_ORDER[j['field']], fold(j['name'])))
    guides.sort(key=lambda g: g.get('order', 100))
    return jobs, guides


FIELD_ORDER = {f[0]: i for i, f in enumerate(FIELDS)}


# --------------------------------------------------------------------------------------------- letter + cv models
def sender_of(job_or_en, L):
    """[name, street, city, phone, email] of the letter's writer (letter 1 = the CV person)."""
    if 'from' in L:
        name, street, city = L['from']
    else:
        cv = job_or_en['cv']
        name, street, city = cv['name'], cv['street'], cv['city']
    return [name, street, city, phone_for(name), email_for(name)]


def letter_model(job, L, lang):
    s = S[lang]
    to = L['to']
    sal = to.get('sal', 'none')
    c = to.get('contact', '')
    rec = [to['org']]
    if sal in ('f', 'm'):
        rec.append(fmt(s['to_' + sal], c=c))
    elif sal == 'n':
        rec.append(c)
    rec += [x for x in (to.get('street'), to.get('city'), to.get('country')) if x]
    salutation = fmt(s['sal_' + sal], c=c) if sal != 'none' else s['sal_none']
    subject = fmt(s['subject'], p=L['position']) + (fmt(s['subject_ref'], r=L['ref']) if L.get('ref') else '')
    closing = s['closing'] if lang == 'de' else (s['closing_named'] if sal != 'none' else s['closing_anon'])
    sender = sender_of(job, L)
    place = re.sub(r'^\d{4,5}\s+', '', sender[2]) if lang == 'de' else ''
    return {'sender': sender, 'recipient': rec, 'salutation': salutation, 'subject': subject, 'closing': closing,
            'place': place, 'body': L['body'], 'att': L['att']}


def norm_row(sec, r):
    """Single dates (a course, a two-week internship) are shown without "seit": move them to the "to" field."""
    a, b = r[0], r[1]
    if (sec == 'courses' and a and not b) or (a and a == b):
        return ['', a] + list(r[2:])
    return list(r)


def cv_tool(cv, lang, phone, email):
    """CV in the shape of lib/tpl-cv.js newCv() (+ photo URL) – the CV builder takes it over as is."""
    row = lambda r: {'from': r[0], 'to': r[1], 'role': r[2], 'org': r[3], 'place': r[4], 'desc': r[5]}
    return {
        'design': cv.get('design', 'modern'), 'accent': ACCENTS[cv.get('accent', 0)], 'photoShape': cv.get('shape', 'circle'),
        'name': cv['name'], 'title': cv['title'], 'street': cv['street'], 'city': cv['city'], 'phone': phone, 'email': email,
        'web': cv.get('web', ''), 'birth': cv.get('birth', ''), 'nationality': cv.get('nationality', ''),
        'exp': [row(norm_row('exp', r)) for r in cv['exp']], 'edu': [row(norm_row('edu', r)) for r in cv['edu']],
        'courses': [row(norm_row('courses', r)) for r in cv.get('courses', [])],
        'skills': [{'name': n, 'level': str(lv)} for n, lv in cv['skills']], 'langs': [{'name': n, 'level': lv} for n, lv in cv['langs']],
        'hobbies': cv.get('hobbies', ''), 'order': cv.get('order', CV_SECTIONS), 'hide': {}, 'signLine': lang == 'de',
        'place': re.sub(r'^\d{4,5}\s+', '', cv['city']) if lang == 'de' else '', 'date': '',
        'photo': f"{IMG}avatar/{cv['avatar']}.png" if cv.get('avatar') else '',
    }


def letter_tool(job, L, lang):
    to = L['to']
    sender = sender_of(job, L)
    body = list(L['body']) + [''] * (4 - len(L['body']))
    cv = job['cv']
    return {
        'position': L['position'], 'refNo': L.get('ref', ''), 'rName': to['org'], 'salMode': to.get('sal', 'none'),
        'contact': to.get('contact', ''), 'rStreet': to.get('street', ''), 'rCity': to.get('city', ''), 'rCountry': to.get('country', ''),
        'p1': body[0], 'p2': body[1], 'p3': body[2], 'p4': body[3], 'start': '', 'salary': '',
        'enclosures': '\n'.join(L['att']),
        'sName': sender[0], 'sStreet': sender[1], 'sCity': sender[2], 'sPhone': sender[3], 'sMail': sender[4],
        'place': re.sub(r'^\d{4,5}\s+', '', sender[2]) if lang == 'de' else '',
        'design': cv.get('design', 'modern'), 'accent': ACCENTS[cv.get('accent', 0)],
    }


def prefill_data(job, lang):
    src = job if lang == 'de' else job['en']
    name = src['cv']['name']
    sender = sender_of(src, src['letters'][0])
    return {'v': 1, 'id': job['id'] if lang == 'de' else 'en-' + job['id'], 'lang': lang, 'name': src['name'],
            'cv': cv_tool(src['cv'], lang, sender[3], sender[4]),
            'letters': [{'label': L['label'], 'cl': letter_tool(src, L, lang)} for L in src['letters']],
            'cvName': name}


# --------------------------------------------------------------------------------------------- html parts
def esc(t):
    import html
    return html.escape(str(t), quote=True)


def para(t):
    return f'<p>{esc(t)}</p>'


def field_icon(fid, cls='vl-fic'):
    f = FIELD[fid]
    return f'<span class="wt-chip-ic tic-{f[3]} {cls}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{f[4]}</svg></span>'


def level_pills(levels, lang):
    i = 1 if lang == 'de' else 2
    return ''.join(f'<span class="vl-pill">{esc(LEVEL[lv][i])}</span>' for lv in levels)


def tool_url(wb_specs, tid, lang):
    sp = wb_specs.get(tid)
    if not sp:
        return None
    return ('/werkzeuge/' if lang == 'de' else '/en/tools/') + sp[lang]['slug'] + '/'


def paper_html(m, lang, idx):
    s = S[lang]
    sender = '<br>'.join(esc(x) for x in m['sender'][:3]) + '<br>' + esc(m['sender'][3]) + ' · ' + esc(m['sender'][4])
    rec = '<br>'.join(esc(x) for x in m['recipient'])
    date = (esc(m['place']) + ', ' if m['place'] else '') + esc(s['date_ph'])
    body = ''.join(para(p) for p in m['body'])
    att = '<br>'.join(esc(a) for a in m['att'])
    return (f'<div class="vl-paper" id="brief-{idx + 1}-text" aria-label="{esc(s["paper_label"])}">'
            f'<p class="vl-p-sender">{sender}</p><p class="vl-p-rec">{rec}</p><p class="vl-p-date">{date}</p>'
            f'<p class="vl-p-subj"><strong>{esc(m["subject"])}</strong></p><p>{esc(m["salutation"])}</p>{body}'
            f'<p class="vl-p-close">{esc(m["closing"])}</p><p class="vl-p-sig">{esc(m["sender"][0])}</p>'
            f'<p class="vl-p-att"><strong>{esc(s["att"])}</strong><br>{att}</p></div>')


def span_text(a, b, lang):
    s = S[lang]
    if a and b:
        return f'{a} – {b}'
    if a:
        return f'{s["since"]} {a}' if lang == 'de' else f'{a} – {s["today"]}'
    return b


def cv_html(cv, lang, phone, email, thumb, use_url):
    s = S[lang]

    def rows(sec):
        out = ''
        for a, b, role, org, place, desc in (norm_row(sec, r) for r in cv.get(sec, [])):
            sub = ', '.join(x for x in (org, place) if x)
            items = ''.join(f'<li>{esc(x.lstrip("-–• ").strip())}</li>' for x in desc.split('\n') if x.strip())
            out += (f'<li><span class="vl-when">{esc(span_text(a, b, lang))}</span><div><strong>{esc(role)}</strong>'
                    f'{"<br><span class=vl-org>" + esc(sub) + "</span>" if sub else ""}{"<ul>" + items + "</ul>" if items else ""}</div></li>')
        return f'<h4>{s[sec]}</h4><ul class="vl-tl">{out}</ul>' if out else ''
    skills = ', '.join(esc(n) for n, _ in cv['skills'])
    langs = ', '.join(f'{esc(n)} ({esc(LANG_LEVEL_LABEL[lang][lv])})' for n, lv in cv['langs'])
    design = DESIGNS[cv.get('design', 'modern')][0 if lang == 'de' else 1]
    img = ''
    if thumb:
        img = (f'<a class="vl-cv-thumb" href="{use_url}"><img src="{thumb}" width="{THUMB_W}" height="{THUMB_H}" loading="lazy" decoding="async" '
               f'alt="{esc(fmt(s["cv_preview_alt"], name=cv["name"], design=design))}"></a>')
    contact = ' · '.join(esc(x) for x in (f'{cv["street"]}, {cv["city"]}', phone, email))
    hobbies = f'<h4>{s["hobbies"]}</h4><p>{esc(cv["hobbies"])}</p>' if cv.get('hobbies') else ''
    return f'''<div class="vl-cv">
      {img}
      <div class="vl-cv-data">
        <div class="vl-cv-person"><img src="{IMG}avatar/{cv['avatar']}.svg" width="72" height="96" alt="" class="vl-avatar"><div><p class="vl-cv-name">{esc(cv['name'])}</p><p class="vl-cv-title">{esc(cv['title'])}</p><p class="vl-cv-contact">{contact}</p></div></div>
        <p class="vl-photo-hint">{esc(s['cv_photo_hint'])}</p>
        {rows('exp')}{rows('edu')}{rows('courses')}
        <h4>{s['skills']}</h4><p>{skills}</p>
        <h4>{s['langs']}</h4><p>{langs}</p>
        {hobbies}
      </div>
    </div>'''


def head_for(wb, bp, lang, title, desc, ld, self_path, pair):
    """bp.head() with hreflang only for real DE/EN pairs (pair = (de, en) or None)."""
    paths = pair or ((self_path, self_path))
    h = bp.head(lang, 'home', esc(title), esc(desc), ld, paths=paths, og_image=wb.OG_IMAGE[lang], og_alt=esc(S[lang]['og_alt']),
                extra_head=wb.extra_head(lang) + '\n  <link rel="stylesheet" href="/assets/wt/vl.css">')
    if not pair:
        lines = []
        for line in h.split('\n'):
            if 'hreflang="de"' in line or 'hreflang="en"' in line or 'hreflang="x-default"' in line:
                if f'hreflang="{lang}"' in line:
                    lines.append(line)
                    lines.append(f'  <link rel="alternate" hreflang="x-default" href="{bp.BASE}{self_path}">')
                continue
            lines.append(line)
        h = '\n'.join(lines)
    return h


def crumbs(wb, lang, items):
    return wb.crumbs(lang, [(n, h if i < len(items) - 1 else None) for i, (n, h) in enumerate(items)])


def config_script(obj):
    data = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True).replace('</', '<\\/')
    return f'<script type="application/json" id="vl-config">{data}</script>\n<script type="module" src="/assets/wt/vl.js"></script>'


def faq_html(items):
    return ''.join(f'<details><summary>{esc(q)}</summary><div><p>{esc(a)}</p></div></details>' for q, a in items)


def ld_faq(items, lang):
    return {'@context': 'https://schema.org', '@type': 'FAQPage', 'inLanguage': lang, 'mainEntity': [
        {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in items]}


def icon_sprite():
    """Field icons as <symbol>s, once per page; cards reference them with <use> (keeps the 200+ card directory small)."""
    return ('<svg class="vl-sprite" hidden aria-hidden="true">' + ''.join(
        f'<symbol id="vl-i-{f[0]}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
        f'stroke-linejoin="round">{f[4]}</symbol>' for f in FIELDS) + '</svg>')


def job_card(job, lang, heading='h3', sprite=False):
    s = S[lang]
    src = job if lang == 'de' else job['en']
    # name, short text and level pills are visible card text – vl.js adds the card's text to the search haystack
    kw = ' '.join([src.get('search', ''), FIELD[job['field']][1 if lang == 'de' else 2]])
    f = FIELD[job['field']]
    icon = (f'<span class="wt-chip-ic tic-{f[3]} vl-fic"><svg width="24" height="24" aria-hidden="true"><use href="#vl-i-{f[0]}"/></svg></span>'
            if sprite else field_icon(job['field']))
    return (f'<li class="wt-card vl-card" data-field="{job["field"]}" data-levels="{" ".join(job["levels"])}" data-search="{esc(fold(kw))}">'
            f'<a href="{job_path(job, lang)}">{icon}<{heading} class="wt-card-name">{esc(src["name"])}</{heading}>'
            f'<span class="wt-card-desc">{esc(src["short"])}</span><span class="vl-pills">{level_pills(job["levels"], lang)}</span></a></li>')


def kuendigung_card(wb_specs):
    u = tool_url(wb_specs, 'cancellation-letter', 'de')
    if not u:
        return ''
    n, d = S['de']['kuendigung']
    return f'<li class="wt-card"><a href="{u}"><h3 class="wt-card-name">{esc(n)}</h3><span class="wt-card-desc">{esc(d)}</span></a></li>'


def tools_row(wb_specs, lang):
    ids = ['cv-builder', 'cover-letter', 'passport-photo', 'merge-pdf', 'compress-pdf', 'cancellation-letter']
    cards = []
    for tid in ids:
        sp = wb_specs.get(tid)
        if sp:
            cards.append(f'<li class="wt-card"><a href="{tool_url(wb_specs, tid, lang)}"><h3 class="wt-card-name">{esc(sp[lang]["name"])}</h3>'
                         f'<span class="wt-card-desc">{esc(sp[lang].get("short") or sp[lang]["lede"])}</span></a></li>')
    return ''.join(cards)


# --------------------------------------------------------------------------------------------- pages
def page_job(wb, bp, job, lang, by_id, wb_specs):
    s = S[lang]
    src = job if lang == 'de' else job['en']
    path = job_path(job, lang)
    pair = (job_path(job, 'de'), job_path(job, 'en')) if 'en' in job else None
    vid = job['id'] if lang == 'de' else 'en-' + job['id']
    cv_tool_url = tool_url(wb_specs, 'cv-builder', lang) + f'?vorlage={vid}'
    cl_url = tool_url(wb_specs, 'cover-letter', lang) + f'?vorlage={vid}'
    name = src['name']
    title = fmt(s['job_title'], name=name)
    if len(title) > 66:
        title = fmt(s['job_title_short'], name=name)
    if lang == 'de':
        items = [(s['home'], '/'), (s['hub'], HUB['de']), (s['section'], SECTION), (name, path)]
    else:
        items = [(s['home'], '/en/'), (s['hub'], HUB['en']), (name, path)]
    sender0 = sender_of(src, src['letters'][0])
    thumb_file = bp.ROOT / IMG.strip('/') / 'cv' / f'{vid}.webp'
    thumb = f'{IMG}cv/{vid}.webp' if thumb_file.exists() else None
    letters = ''
    for i, L in enumerate(src['letters']):
        m = letter_model(src, L, lang)
        lv = LEVEL[L['level']][1 if lang == 'de' else 2]
        letters += (f'<details class="vl-letter" id="brief-{i + 1}"{" open" if i == 0 else ""}><summary><span class="vl-letter-n">{i + 1}</span>'
                    f'<span class="vl-letter-t">{esc(L["label"])}</span><span class="vl-pill">{esc(lv)}</span></summary>'
                    f'<div class="vl-letter-body">{paper_html(m, lang, i)}<div class="btn-row vl-actions">'
                    f'<a class="btn btn-primary" href="{cl_url}&amp;brief={i + 1}">{s["use_letter"]}</a>'
                    f'<button class="btn btn-quiet" type="button" data-vl-copy="brief-{i + 1}-text" hidden>{s["copy"]}</button></div></div></details>')
    look = ''.join(f'<li>{wb.svg(wb.UI_ICONS["check"])}<div><p>{esc(x)}</p></div></li>' for x in src['lookFor'])
    do = ''.join(f'<li>{esc(x)}</li>' for x in src['do'])
    dont = ''.join(f'<li>{esc(x)}</li>' for x in src['dont'])
    qs = ''.join(f'<li>{esc(x)}</li>' for x in src['questions'])
    pay = src.get('pay', '')
    faq_items = [(f['q'], f['a']) for f in src['faq']] + [s['faq_photo'], s['faq_copy'], s['faq_privacy']]
    if lang == 'de':
        rel = [by_id[r] for r in job['related'] if r in by_id]
    else:
        rel = [r for r in (by_id[x] for x in job['related']) if 'en' in r]
        rel += [j for j in by_id.values() if 'en' in j and j is not job and j not in rel and j['field'] == job['field']]
        rel += [j for j in by_id.values() if 'en' in j and j is not job and j not in rel]
        rel = rel[:4]
    related = ''.join(job_card(r, lang) for r in rel[:6])
    start = ''.join(f'<li class="wt-step"><h3>{esc(t)}</h3><p>{esc(p)}</p></li>' for t, p in s['start'])
    ld = [
        wb.ld_breadcrumb(items),
        {'@context': 'https://schema.org', '@type': 'CreativeWork', 'name': fmt(s['job_h1'], name=name), 'url': bp.BASE + path,
         'description': src['desc'], 'inLanguage': lang, 'isAccessibleForFree': True, 'genre': 'Bewerbungsvorlage' if lang == 'de' else 'CV and cover letter template',
         'about': {'@type': 'Occupation', 'name': name}, 'publisher': {'@type': 'Organization', 'name': 'FaleNetwork', 'url': bp.BASE + '/'}},
        {'@context': 'https://schema.org', '@type': 'HowTo', 'name': s['start_h'], 'inLanguage': lang,
         'step': [{'@type': 'HowToStep', 'position': i + 1, 'name': t, 'text': p} for i, (t, p) in enumerate(s['start'])]},
        ld_faq(faq_items, lang),
    ]
    h = head_for(wb, bp, lang, title, src['desc'], ld, path, pair)
    other = 'en' if lang == 'de' else 'de'
    hdr = bp.header(lang, 'home', current=HUB[lang], other_url=job_path(job, other) if pair else HUB[other], fallback=not pair)
    body = f'''
<main id="main" class="wt-page vl-page" {MARK}="job">
  <div class="wrap wt-top">
    {crumbs(wb, lang, items)}
    <div class="wt-head">{field_icon(job['field'], 'wt-chip-lg')}<div><h1>{esc(fmt(s['job_h1'], name=name))}</h1><p class="wt-lede">{esc(fmt(s['job_lede'], n=len(src['letters'])))}</p></div></div>
    <p class="vl-pills vl-head-pills">{level_pills(job['levels'], lang)}</p>
    <div class="vl-hero">
      <div class="btn-row"><a class="btn btn-primary" href="{cv_tool_url}">{s['use_cv']}</a><a class="btn btn-quiet" href="#anschreiben">{s['use_letters']}</a></div>
      <ol class="wt-steps vl-start" aria-label="{esc(s['start_h'])}">{start}</ol>
    </div>
  </div>
  <section class="section wt-sec" aria-labelledby="look-h">
    <div class="wrap">
      <h2 id="look-h">{s['look_h']}</h2>
      <p class="vl-intro">{esc(src['intro'])}</p>
      <ul class="wt-why vl-look">{look}</ul>
    </div>
  </section>
  <section class="section wt-sec" id="anschreiben" aria-labelledby="letters-h">
    <div class="wrap">
      <h2 id="letters-h">{s['letters_h']}</h2>
      <p class="vl-sub">{s['letters_p']}</p>
      <div class="vl-letters">{letters}</div>
      <p class="vl-fine">{s['example_note']}</p>
    </div>
  </section>
  <section class="section wt-sec" id="lebenslauf" aria-labelledby="cv-h">
    <div class="wrap">
      <h2 id="cv-h">{s['cv_h']}</h2>
      <p class="vl-sub">{s['cv_p']}</p>
      {cv_html(src['cv'], lang, sender0[3], sender0[4], thumb, cv_tool_url)}
      <div class="btn-row vl-actions"><a class="btn btn-primary" href="{cv_tool_url}">{s['use_cv']}</a></div>
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="tips-h">
    <div class="wrap">
      <h2 id="tips-h">{s['tips_h']}</h2>
      <div class="vl-dodont"><div class="vl-do"><h3>{s['do']}</h3><ul>{do}</ul></div><div class="vl-dont"><h3>{s['dont']}</h3><ul>{dont}</ul></div></div>
      <h3 class="vl-h3">{s['q_h']}</h3>
      <p class="vl-sub">{s['q_p']}</p>
      <ol class="vl-questions">{qs}</ol>
      <h3 class="vl-h3">{s['pay_h']}</h3>
      <p class="vl-sub">{esc((pay + ' ') if pay else '')}{esc(s['pay_generic'])}</p>
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="faq-h">
    <div class="wrap">
      <h2 id="faq-h">{s['faq_h']}</h2>
      <div class="faq">{faq_html(faq_items)}</div>
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="rel-h">
    <div class="wrap">
      <h2 id="rel-h">{s['related_h']}</h2>
      <ul class="wt-grid">{related}</ul>
      <h2 class="vl-h2b" id="tools-h">{s['tools_h']}</h2>
      <p class="vl-sub">{s['tools_p']}</p>
      <ul class="wt-grid">{tools_row(wb_specs, lang)}</ul>
    </div>
  </section>
</main>
{config_script({'v': 1, 'lang': lang, 'page': 'job', 'copied': s['copied']})}
'''
    return h + '\n' + hdr + body + bp.footer(lang)


def chips(name, options, lang, label):
    s = S[lang]
    btns = f'<li><button type="button" class="wt-cat" data-vl-{name}="" aria-pressed="true">{s["all"]}</button></li>' + ''.join(
        f'<li><button type="button" class="wt-cat" data-vl-{name}="{oid}" aria-pressed="false">{esc(lab)}</button></li>' for oid, lab in options)
    return f'<div class="vl-filter" data-vl-filter hidden><p class="vl-filter-l" id="vl-{name}-l">{label}</p><ul class="wt-cats" aria-labelledby="vl-{name}-l">{btns}</ul></div>'


def page_section(wb, bp, jobs, guides, wb_specs):
    s = S['de']
    items = [(s['home'], '/'), (s['hub'], HUB['de']), (s['section'], SECTION)]
    used = [f for f in FIELDS if any(j['field'] == f[0] for j in jobs)]
    groups = ''
    for f in used:
        cards = ''.join(job_card(j, 'de', sprite=True) for j in jobs if j['field'] == f[0])
        groups += (f'<section class="wt-catsec" id="feld-{f[0]}" data-vl-group="{f[0]}" aria-labelledby="g-{f[0]}">'
                   f'<div class="wt-catsec-head"><h2 id="g-{f[0]}">{esc(f[1])}</h2></div><ul class="wt-grid">{cards}</ul></section>')
    guide_cards = ''.join(f'<li class="wt-card"><a href="{guide_path(g)}"><h3 class="wt-card-name">{esc(g["card"])}</h3><span class="wt-card-desc">{esc(g["short"])}</span></a></li>' for g in guides) + kuendigung_card(wb_specs)
    faq_items = [s['faq_photo'], s['faq_copy'], s['faq_privacy']]
    ld = [
        {'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': s['sec_h1'], 'url': bp.BASE + SECTION, 'inLanguage': 'de',
         'description': fmt(s['sec_desc'], n=len(jobs)),
         'mainEntity': {'@type': 'ItemList', 'numberOfItems': len(jobs), 'itemListElement': [
             {'@type': 'ListItem', 'position': i + 1, 'name': j['name'], 'url': bp.BASE + job_path(j, 'de')} for i, j in enumerate(jobs)]}},
        wb.ld_breadcrumb(items), ld_faq(faq_items, 'de')]
    h = head_for(wb, bp, 'de', s['sec_title'], fmt(s['sec_desc'], n=len(jobs)), ld, SECTION, None)
    hdr = bp.header('de', 'home', current=HUB['de'], other_url=HUB['en'], fallback=True)
    field_chips = chips('field', [(f[0], f[1]) for f in used], 'de', s['filter_field'])
    level_chips = chips('level', [(lv[0], lv[1]) for lv in LEVELS if any(lv[0] in j['levels'] for j in jobs)], 'de', s['filter_level'])
    body = f'''
<main id="main" class="wt-page vl-page" {MARK}="section">
  <div class="wrap wt-top">
    {crumbs(wb, 'de', items)}
    <h1>{s['sec_h1']}</h1>
    <p class="wt-lede">{s['sec_lede']}</p>
    <div class="wt-search" data-vl-search hidden>
      <label for="vl-q">{wb.svg(wb.UI_ICONS['search'])}<span class="sr-only">{s['search_label']}</span></label>
      <input id="vl-q" type="search" placeholder="{s['search_ph']}" autocomplete="off" enterkeyhint="search" data-vl-q>
    </div>
    {field_chips}
    {level_chips}
    <p class="vl-count" data-vl-count aria-live="polite"></p>
    <p class="wt-nohits" data-vl-nohits hidden>{s['no_hits']}</p>
    {icon_sprite()}{groups}
  </div>
  <section class="section wt-sec" aria-labelledby="guides-h">
    <div class="wrap">
      <h2 id="guides-h">{s['guides']}</h2>
      <ul class="wt-grid">{guide_cards}</ul>
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="faq-h">
    <div class="wrap">
      <h2 id="faq-h">{s['faq_h']}</h2>
      <div class="faq">{faq_html(faq_items)}</div>
    </div>
  </section>
</main>
{config_script({'v': 1, 'lang': 'de', 'page': 'section', 'hits': s['hits'], 'hit1': s['hit1']})}
'''
    return h + '\n' + hdr + body + bp.footer('de')


TILE_ICONS = {
    'job': ('tone-p', '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17"/>'),
    'design': ('tone-a', '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M9.5 3.5v17M13 8h4M13 12h4M13 16h2.5"/>'),
    'letter': ('tone-w', '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>'),
    'sheet': ('tone-a', '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M3.5 15h17M9.5 4v16"/>'),
    'form': ('tone-p', '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 7.5l2 2"/>'),
    'guide': ('tone-w', '<path d="M4 5.5A2 2 0 0 1 6 3.5h13v14H6a2 2 0 0 0-2 2z"/><path d="M4 19.5a2 2 0 0 0 2 2h13v-4"/><path d="M8.5 8h6"/>'),
}


def tiles(items, label):
    """Collection tiles (same look as the entry cards on the home page): (href, title, count line, icon kind)."""
    out = ''
    for href, title, meta, kind in items:
        tone, paths = TILE_ICONS[kind]
        out += (f'<li><a class="tile" href="{href}"><span class="entry-ic {tone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                f'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{paths}</svg></span>'
                f'<strong>{esc(title)}</strong><span>{esc(meta)}</span></a></li>')
    return f'<ul class="tiles" aria-label="{label}">{out}</ul>'


def page_hub(wb, bp, jobs, guides, wb_specs, lang):
    s = S[lang]
    n_en = sum(1 for j in jobs if 'en' in j)
    items = [(s['home'], '/' if lang == 'de' else '/en/'), (s['hub'], HUB[lang])]
    how = ''.join(f'<li class="wt-step"><h3>{esc(t)}</h3><p>{esc(p)}</p></li>' for t, p in s['hub_how'])
    more_ids = ['cancellation-letter', 'din-letter', 'leave-request', 'power-of-attorney', 'invoice-generator', 'receipt', 'payment-reminder', 'withdrawal-letter']
    more_ids = [t for t in more_ids if t in wb_specs]
    more = ''.join(f'<li class="wt-card"><a href="{tool_url(wb_specs, t, lang)}"><h3 class="wt-card-name">{esc(wb_specs[t][lang]["name"])}</h3>'
                   f'<span class="wt-card-desc">{esc(wb_specs[t][lang].get("short") or wb_specs[t][lang]["lede"])}</span></a></li>' for t in more_ids)
    fill_id = 'ausfuellen' if lang == 'de' else 'fill-in'
    extra = [c for h in HUB_EXTRA for c in h(lang)]
    faq_items = [s['faq_photo'], s['faq_copy'], s['faq_privacy']]
    if lang == 'de':
        pop = ''.join(job_card(j, 'de') for j in [j for j in jobs if j.get('popular')][:8])
        lede = s['hub_lede']
        desc = fmt(s['hub_desc'], n=(len(jobs) // 10) * 10)
        coll = [(SECTION, s['hub_apps_h'], fmt(s['hub_apps_m'], n=len(jobs)), 'job')] + extra + [
            (f'#{fill_id}', s['hub_fill_h'], fmt(s['hub_fill_m'], n=len(more_ids)), 'form'),
            ('#ratgeber', s['hub_guides_h'], fmt(s['hub_guides_m'], n=len(guides)), 'guide')]
        guide_cards = ''.join(f'<li class="wt-card"><a href="{guide_path(g)}"><h3 class="wt-card-name">{esc(g["card"])}</h3><span class="wt-card-desc">{esc(g["short"])}</span></a></li>' for g in guides)
        main_block = f'''<div class="wt-search vl-jump" data-vl-jump hidden>
      <label for="vl-jump">{wb.svg(wb.UI_ICONS['search'])}<span class="sr-only">{s['hub_search_label']}</span></label>
      <input id="vl-jump" type="search" placeholder="{s['hub_search_ph']}" autocomplete="off" enterkeyhint="search" data-vl-jump-q>
      <button class="btn btn-primary" type="button" data-vl-jump-go>{s['hub_search_btn']}</button>
    </div>
    {tiles(coll, s['hub_coll_label'])}
    <section class="wt-catsec" aria-labelledby="pop-h"><div class="wt-catsec-head"><h2 id="pop-h">{s['hub_pop_h']}</h2></div><ul class="wt-grid">{pop}</ul>
      <p class="vl-more-link"><a class="btn btn-quiet" href="{SECTION}">{esc(fmt(s['hub_pop_all'], n=len(jobs)))}</a></p></section>
    <section class="wt-catsec" id="ratgeber" aria-labelledby="gd-h"><div class="wt-catsec-head"><h2 id="gd-h">{s['hub_guides_h']}</h2></div><ul class="wt-grid">{guide_cards}</ul></section>'''
        ld_list = [{'@type': 'ListItem', 'position': i + 1, 'name': j['name'], 'url': bp.BASE + job_path(j, 'de')} for i, j in enumerate(jobs)]
        cfg = {'v': 1, 'lang': 'de', 'page': 'hub', 'jump': SECTION}
    else:
        en_jobs = [j for j in jobs if 'en' in j]
        cards = ''.join(job_card(j, 'en') for j in en_jobs)
        lede = s['hub_lede']
        desc = fmt(s['hub_desc'], n=n_en)
        coll = [('#jobs', s['hub_apps_h'], fmt(s['hub_apps_m'], n=n_en), 'job')] + extra + [
            (f'#{fill_id}', s['hub_fill_h'], fmt(s['hub_fill_m'], n=len(more_ids)), 'form')]
        main_block = f'''{tiles(coll, s['hub_coll_label'])}
    <section class="wt-catsec" id="jobs" aria-labelledby="jobs-h"><div class="wt-catsec-head"><h2 id="jobs-h">{s['hub_jobs_h']}</h2></div>
    <div class="wt-search" data-vl-search hidden>
      <label for="vl-q">{wb.svg(wb.UI_ICONS['search'])}<span class="sr-only">{s['search_label']}</span></label>
      <input id="vl-q" type="search" placeholder="{s['search_ph']}" autocomplete="off" enterkeyhint="search" data-vl-q>
    </div>
    <p class="vl-count" data-vl-count aria-live="polite"></p>
    <p class="wt-nohits" data-vl-nohits hidden>{s['no_hits']}</p>
    <div data-vl-group="all"><ul class="wt-grid">{cards}</ul></div></section>'''
        ld_list = [{'@type': 'ListItem', 'position': i + 1, 'name': j['en']['name'], 'url': bp.BASE + job_path(j, 'en')} for i, j in enumerate(en_jobs)]
        cfg = {'v': 1, 'lang': 'en', 'page': 'section', 'hits': s['hits'], 'hit1': s['hit1']}
    ld = [{'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': s['hub_h1'], 'url': bp.BASE + HUB[lang], 'inLanguage': lang, 'description': desc,
           'mainEntity': {'@type': 'ItemList', 'numberOfItems': len(ld_list), 'itemListElement': ld_list}},
          wb.ld_breadcrumb(items), ld_faq(faq_items, lang)]
    h = head_for(wb, bp, lang, s['hub_title'], desc, ld, HUB[lang], (HUB['de'], HUB['en']))
    hdr = bp.header(lang, 'home', current=HUB[lang], other_url=HUB['en' if lang == 'de' else 'de'])
    body = f'''
<main id="main" class="wt-page vl-page" {MARK}="hub">
  <div class="wrap wt-top">
    {crumbs(wb, lang, items)}
    <h1>{s['hub_h1']}</h1>
    <p class="wt-lede">{esc(lede)}</p>
    {main_block}
  </div>
  <section class="section wt-sec" id="{fill_id}" aria-labelledby="more-h">
    <div class="wrap">
      <h2 id="more-h">{s['hub_more_h']}</h2>
      <p class="vl-sub">{s['hub_more_p']}</p>
      <ul class="wt-grid">{more}</ul>
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="how-h">
    <div class="wrap">
      <h2 id="how-h">{s['hub_how_h']}</h2>
      <ol class="wt-steps">{how}</ol>
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="faq-h">
    <div class="wrap">
      <h2 id="faq-h">{s['faq_h']}</h2>
      <div class="faq">{faq_html(faq_items)}</div>
    </div>
  </section>
</main>
{config_script(cfg)}
'''
    return h + '\n' + hdr + body + bp.footer(lang)


def page_guide(wb, bp, g, guides, jobs, wb_specs):
    s = S['de']
    path = guide_path(g)
    items = [(s['home'], '/'), (s['hub'], HUB['de']), (s['guides'], SECTION + '#guides-h'), (g['card'], path)]
    by_id = {j['id']: j for j in jobs}
    secs = ''
    for i, sec in enumerate(g['sections']):
        parts = ''.join(para(p) for p in sec.get('text', []))
        if sec.get('list'):
            parts += '<ul class="vl-list">' + ''.join(f'<li>{esc(x)}</li>' for x in sec['list']) + '</ul>'
        if sec.get('steps'):
            parts += '<ol class="vl-list">' + ''.join(f'<li>{esc(x)}</li>' for x in sec['steps']) + '</ol>'
        if sec.get('example'):
            ex = sec['example']
            lines = ''.join(para(p) for p in ex['lines'])
            parts += (f'<div class="vl-paper vl-mail" id="muster-{i + 1}"><p class="vl-p-subj"><strong>{esc(ex.get("subject", ""))}</strong></p>{lines}</div>'
                      f'<div class="btn-row vl-actions"><button class="btn btn-quiet" type="button" data-vl-copy="muster-{i + 1}" hidden>{s["copy"]}</button></div>')
        if sec.get('tools'):
            links = ''.join(f'<a class="btn btn-quiet" href="{tool_url(wb_specs, t, "de")}">{esc(wb_specs[t]["de"]["name"])}</a>' for t in sec['tools'] if t in wb_specs)
            parts += f'<div class="btn-row vl-actions">{links}</div>'
        if sec.get('jobs'):
            parts += '<ul class="wt-grid vl-mt">' + ''.join(job_card(by_id[j], 'de') for j in sec['jobs'] if j in by_id) + '</ul>'
        secs += f'<section class="vl-gsec" aria-labelledby="gs-{i}"><h2 id="gs-{i}">{esc(sec["h"])}</h2>{parts}</section>'
    faq_items = [(f['q'], f['a']) for f in g['faq']]
    others = ''.join(f'<li class="wt-card"><a href="{guide_path(o)}"><h3 class="wt-card-name">{esc(o["card"])}</h3><span class="wt-card-desc">{esc(o["short"])}</span></a></li>' for o in guides if o is not g)
    ld = [wb.ld_breadcrumb(items),
          {'@context': 'https://schema.org', '@type': 'Article', 'headline': g['h1'], 'description': g['desc'], 'inLanguage': 'de', 'url': bp.BASE + path,
           'isAccessibleForFree': True, 'author': {'@type': 'Organization', 'name': 'FaleNetwork', 'url': bp.BASE + '/'}, 'publisher': {'@type': 'Organization', 'name': 'FaleNetwork', 'url': bp.BASE + '/'}},
          ld_faq(faq_items, 'de')]
    h = head_for(wb, bp, 'de', g['title'], g['desc'], ld, path, None)
    hdr = bp.header('de', 'home', current=HUB['de'], other_url=HUB['en'], fallback=True)
    body = f'''
<main id="main" class="wt-page vl-page" {MARK}="guide">
  <div class="wrap wt-top">
    {crumbs(wb, 'de', items)}
    <h1>{esc(g['h1'])}</h1>
    <p class="wt-lede">{esc(g['lede'])}</p>
  </div>
  <section class="section wt-sec">
    <div class="wrap vl-guide">{secs}</div>
  </section>
  <section class="section wt-sec" aria-labelledby="faq-h">
    <div class="wrap">
      <h2 id="faq-h">{s['faq_h']}</h2>
      <div class="faq">{faq_html(faq_items)}</div>
    </div>
  </section>
  <section class="section wt-sec" aria-labelledby="more-h">
    <div class="wrap">
      <h2 id="more-h">{s['guide_more_h']}</h2>
      <ul class="wt-grid">{others}<li class="wt-card"><a href="{SECTION}"><h3 class="wt-card-name">{s['sec_h1']}</h3><span class="wt-card-desc">{esc(fmt(s['hits'], n=len(jobs)))}</span></a></li></ul>
    </div>
  </section>
</main>
{config_script({'v': 1, 'lang': 'de', 'page': 'guide', 'copied': s['copied']})}
'''
    return h + '\n' + hdr + body + bp.footer('de')


# --------------------------------------------------------------------------------------------- sitemap + cleanup
def merge_sitemap(bp, entries):
    """entries: [(loc, {lang: url})]. Replaces only the archive's URLs, keeps everything else."""
    sm = bp.ROOT / 'sitemap.xml'
    text = sm.read_text(encoding='utf-8') if sm.exists() else ''
    keep = []
    for m in re.finditer(r'^\s*<url>.*?</url>\s*$', text, re.M | re.S):
        block = m.group(0).strip('\n')
        loc = re.search(r'<loc>(.*?)</loc>', block)
        if loc and (loc.group(1).startswith(bp.BASE + HUB['de']) or loc.group(1).startswith(bp.BASE + HUB['en'])):
            continue
        keep.append(block)
    new = []
    for loc, alts in entries:
        a = ''.join(f'<xhtml:link rel="alternate" hreflang="{lg}" href="{bp.BASE}{u}"/>' for lg, u in alts.items())
        xd = alts.get('de') or loc
        a += f'<xhtml:link rel="alternate" hreflang="x-default" href="{bp.BASE}{xd}"/>'
        new.append(f'  <url><loc>{bp.BASE}{loc}</loc>{a}</url>')
    out = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
           + '\n'.join(keep + new) + '\n</urlset>\n')
    if sm.read_text(encoding='utf-8') != out:
        sm.write_text(out, encoding='utf-8')


def cleanup(bp, keep_pages, keep_data):
    for base in (SECTION, GUIDES, HUB['en']):
        d = bp.ROOT / base.strip('/')
        if not d.is_dir():
            continue
        for sub in d.iterdir():
            idx = sub / 'index.html'
            if sub.is_dir() and idx.exists() and MARK in idx.read_text(encoding='utf-8') and f'/{sub.relative_to(bp.ROOT).as_posix()}/' not in keep_pages:
                shutil.rmtree(sub)
    dd = bp.ROOT / DATA_URL.strip('/')
    if dd.is_dir():
        for f in dd.glob('*.json'):
            if f.name not in keep_data:
                f.unlink()


def main(wb=None):
    """Standalone: strict (exit 1 on any data error). Called from webtools/build.py: a data error never breaks the
    tools build – it is printed and the archive pages are left as they are."""
    global LAX
    standalone = wb is None
    if not standalone:
        LAX = True
    wb = wb or wb_module()
    bp = wb.bp
    try:
        jobs, guides = load(wb)
    except DataError as ex:
        print('Vorlagen data errors:\n' + str(ex), file=sys.stderr)
        if standalone:
            sys.exit(1)
        return []
    wb_specs = {sp['id']: sp for sp in wb.load_specs()}
    by_id = {j['id']: j for j in jobs}
    written, entries, keep_data = [], [], set()
    exts = run_extensions(wb, bp, jobs, wb_specs, standalone)
    HUB_EXTRA[:] = [x['hub_cards'] for x in exts if x.get('hub_cards')]
    written.append(wb.write(HUB['de'], page_hub(wb, bp, jobs, guides, wb_specs, 'de')))
    written.append(wb.write(HUB['en'], page_hub(wb, bp, jobs, guides, wb_specs, 'en')))
    entries += [(HUB['de'], dict(HUB)), (HUB['en'], dict(HUB))]
    written.append(wb.write(SECTION, page_section(wb, bp, jobs, guides, wb_specs)))
    entries.append((SECTION, {'de': SECTION}))
    for g in guides:
        written.append(wb.write(guide_path(g), page_guide(wb, bp, g, guides, jobs, wb_specs)))
        entries.append((guide_path(g), {'de': guide_path(g)}))
    for j in jobs:
        langs = ('de', 'en') if 'en' in j else ('de',)
        alts = {lg: job_path(j, lg) for lg in langs}
        for lg in langs:
            written.append(wb.write(job_path(j, lg), page_job(wb, bp, j, lg, by_id, wb_specs)))
            entries.append((job_path(j, lg), alts))
            data = prefill_data(j, lg)
            fname = data['id'] + '.json'
            keep_data.add(fname)
            written.append(wb.write(DATA_URL + fname, json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n'))
    for x in exts:
        written += x['written']
        entries += x['entries']
        for fname, text in sorted(x['data'].items()):
            keep_data.add(fname)
            written.append(wb.write(DATA_URL + fname, text))
        print(x.get('summary', ''))
    written.append(wb.write(DATA_URL + 'index.json', json.dumps({'v': 1, 'ids': sorted(f[:-5] for f in keep_data)}, separators=(',', ':')) + '\n'))
    keep_data.add('index.json')
    for aid in AVATARS:
        written.append(wb.write(f'{IMG}avatar/{aid}.svg', avatar_svg(aid)))
    cleanup(bp, {p for p, _ in entries}, keep_data)
    merge_sitemap(bp, entries)
    n_en = sum(1 for j in jobs if 'en' in j)
    print(f'Vorlagen: {len(jobs)} jobs ({n_en} with EN), {len(guides)} guides, {len(written)} files')
    return written


if __name__ == '__main__':
    main()
