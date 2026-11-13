"""Two filled-in copies of formcheck/antrag.pdf for test_formdata.py („Formulardaten sammeln“):
Anna (amount 12,50, PLZ with a leading zero, consent ticked) and Ben (amount 1.200,00, consent empty).
Run after gen.py."""
import os
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

HERE = os.path.dirname(os.path.abspath(__file__))
PEOPLE = {
    'anna': ({'name': 'Anna Beispiel', 'geburtsdatum': '03.04.1961', 'email': 'anna@example.org', 'plz': '06630', 'iban': 'DE89370400440532013000',
              'betrag': '12,50', 'termin': '01.12.2026', 'ort_datum': 'Naumburg, 02.11.2026'}, True),
    'ben': ({'name': 'Ben Muster', 'geburtsdatum': '17.09.1958', 'email': 'ben@example.org', 'plz': '50667', 'iban': 'DE02120300000000202051',
             'betrag': '1.200,00', 'termin': '15.12.2026', 'ort_datum': 'Köln, 03.11.2026'}, False),
}
for who, (values, consent) in PEOPLE.items():
    w = PdfWriter(); w.append(PdfReader(os.path.join(HERE, 'antrag.pdf')))
    w.update_page_form_field_values(w.pages[0], values, auto_regenerate=False)
    w.set_need_appearances_writer(True)
    for annot in w.pages[0]['/Annots']:
        a = annot.get_object()
        if a.get('/T') == 'einwilligung':
            on = next((k for k in a['/AP']['/N'].keys() if k != '/Off'), '/Yes')
            a[NameObject('/V')] = NameObject(on if consent else '/Off')
            a[NameObject('/AS')] = NameObject(on if consent else '/Off')
    out = os.path.join(HERE, f'mitglied_{who}.pdf')
    w.write(out)
    print('written', out)
