"""Generate realistic (fictional) demo files for store screenshots, German + English."""
import os, sys, random
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
import openpyxl
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Font, PatternFill, Alignment
import docx
from docx.shared import Pt, RGBColor
import pptx
from pptx.util import Inches, Pt as PPt
from pptx.dml.color import RGBColor as PRGB
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'demo')

T = {
 'de': dict(
   inv_file='Rechnung_2026-0412.pdf', inv_title='Rechnung', inv_no='Rechnungsnr.', inv_date='Datum', due='Fällig bis',
   company='Malerbetrieb Sonnenfeld GmbH', company_addr='Hafenstraße 8 · 66111 Saarbrücken',
   to=['Anna Berger', 'Lindenweg 12', '66119 Saarbrücken'], date='02.10.2026', duedate='16.10.2026',
   cols=['Pos.', 'Beschreibung', 'Menge', 'Einzelpreis', 'Gesamt'],
   items=[('Wohnzimmer streichen, Wände und Decke', '42 m²', 14.50), ('Flur tapezieren inkl. Material', '18 m²', 22.00), ('Abdeckarbeiten und Reinigung', '1 psch.', 95.00), ('Lackierung Türzarge', '3 Stk.', 38.00)],
   net='Nettobetrag', vat='zzgl. 19 % MwSt.', total='Gesamtbetrag', thanks='Vielen Dank für Ihren Auftrag! Bitte überweisen Sie den Betrag bis zum Fälligkeitsdatum.',
   bank='IBAN DE00 0000 0000 0000 0000 00 · Sparkasse Saarbrücken', money=lambda v: f"{v:,.2f} €".replace(',', 'X').replace('.', ',').replace('X', '.'),
   lease_file='Mietvertrag_Wohnung.pdf', lease_title='Mietvertrag für Wohnraum',
   lease_parties=['Zwischen', 'Hausverwaltung Kessler & Sohn, Bahnhofstraße 21, 66111 Saarbrücken (Vermieter)', 'und', 'Anna Berger, Lindenweg 12, 66119 Saarbrücken (Mieterin)', 'wird folgender Mietvertrag geschlossen:'],
   lease_sections=[('§ 1 Mietsache', 'Vermietet wird die Wohnung im 2. Obergeschoss links des Hauses Rosenstraße 5, 66123 Saarbrücken, bestehend aus 3 Zimmern, Küche, Bad und Balkon. Die Wohnfläche beträgt ca. 74 m².'),
                   ('§ 2 Mietzeit', 'Das Mietverhältnis beginnt am 01.11.2026 und läuft auf unbestimmte Zeit. Es kann von beiden Seiten nach den gesetzlichen Vorschriften gekündigt werden.'),
                   ('§ 3 Miete und Nebenkosten', 'Die monatliche Grundmiete beträgt 690,00 €. Für Betriebskosten wird eine monatliche Vorauszahlung von 180,00 € vereinbart. Die Miete ist monatlich im Voraus, spätestens am dritten Werktag, zu zahlen.'),
                   ('§ 4 Kaution', 'Die Mieterin leistet eine Mietsicherheit in Höhe von drei Grundmieten (2.070,00 €). Sie kann in drei gleichen monatlichen Teilzahlungen erbracht werden.'),
                   ('§ 5 Schönheitsreparaturen', 'Die Wohnung wird renoviert übergeben. Kleinere Instandhaltungen bis 100,00 € je Einzelfall trägt die Mieterin.'),
                   ('§ 6 Haustiere', 'Die Haltung von Kleintieren ist erlaubt. Für andere Haustiere ist die vorherige Zustimmung des Vermieters erforderlich.')],
   sign_place='Saarbrücken, den 05.10.2026', sign_l='Vermieter', sign_r='Mieterin',
   cv_file='Lebenslauf_Anna_Berger.docx', cv_title='Lebenslauf', cv_sub='Anna Berger · Projektmanagerin',
   cv_contact='Lindenweg 12, 66119 Saarbrücken · anna.berger@example.com · 0170 0000000',
   cv_h=['Berufserfahrung', 'Ausbildung', 'Kenntnisse'],
   cv_exp=[('seit 03/2022', 'Projektmanagerin, Solartechnik Saar GmbH', 'Leitung von Kundenprojekten mit bis zu 12 Personen, Budgetverantwortung, Einführung digitaler Abläufe.'),
           ('09/2018 – 02/2022', 'Projektassistentin, Stadtwerke Neunkirchen', 'Planung und Koordination von Bauprojekten, Berichtswesen und Terminplanung.')],
   cv_edu=[('2014 – 2018', 'B.A. Betriebswirtschaft, Hochschule Saarbrücken', 'Schwerpunkt Projekt- und Prozessmanagement')],
   cv_skills='Projektplanung · Tabellenkalkulation · Präsentationen · Englisch (fließend) · Französisch (gut)',
   xlsx_file='Haushaltsbuch_2026.xlsx', sheet='Haushalt', months=['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun'],
   xh=['Monat', 'Einnahmen', 'Ausgaben', 'Saldo'], chart_title='Einnahmen und Ausgaben', total_lbl='Summe',
   pptx_file='Projekt_Solarpark.pptx', p_title='Projekt Solarpark Saar', p_sub='Kick-off · Oktober 2026',
   p2_title='Zeitplan', p2_items=['Planung und Genehmigung bis Dezember', 'Ausschreibung im ersten Quartal', 'Bau ab April 2027', 'Inbetriebnahme im Herbst 2027'],
   scan_file='Scan_Hausverwaltung.jpg', letter_from='Hausverwaltung Kessler & Sohn · Bahnhofstraße 21 · 66111 Saarbrücken',
   letter_to=['Frau', 'Anna Berger', 'Lindenweg 12', '66119 Saarbrücken'], letter_date='Saarbrücken, 28.09.2026',
   letter_subj='Ankündigung: Wartung der Heizungsanlage',
   letter_body=['Sehr geehrte Frau Berger,', '', 'am Dienstag, den 14. Oktober 2026, wird zwischen', '8:00 und 12:00 Uhr die Heizungsanlage im Haus', 'Lindenweg 12 gewartet. In dieser Zeit stehen', 'Heizung und Warmwasser nicht zur Verfügung.', '', 'Bitte sorgen Sie dafür, dass die Heizkörper in', 'Ihrer Wohnung zugänglich sind. Bei Fragen', 'erreichen Sie uns unter 0681 000000.', '', 'Vielen Dank für Ihr Verständnis.', '', 'Mit freundlichen Grüßen', 'Thomas Kessler'],
 ),
 'en': dict(
   inv_file='Invoice_2026-0412.pdf', inv_title='Invoice', inv_no='Invoice no.', inv_date='Date', due='Due date',
   company='Brightwall Painting Ltd.', company_addr='8 Harbour Street · Bristol BS1 4RN',
   to=['Anna Berger', '12 Linden Road', 'Bristol BS6 5AA'], date='Oct 2, 2026', duedate='Oct 16, 2026',
   cols=['Item', 'Description', 'Qty', 'Unit price', 'Amount'],
   items=[('Paint living room, walls and ceiling', '42 m²', 14.50), ('Wallpaper hallway incl. material', '18 m²', 22.00), ('Masking and cleaning', '1 flat', 95.00), ('Repaint door frames', '3 pcs', 38.00)],
   net='Subtotal', vat='VAT 20 %', total='Total', thanks='Thank you for your business! Please pay the amount by the due date.',
   bank='Account 00000000 · Sort code 00-00-00', money=lambda v: f"£{v:,.2f}",
   lease_file='Rental_Agreement.pdf', lease_title='Residential Tenancy Agreement',
   lease_parties=['This agreement is made between', 'Kessler & Son Property Management, 21 Station Road, Bristol BS1 2AB (Landlord)', 'and', 'Anna Berger, 12 Linden Road, Bristol BS6 5AA (Tenant)', 'on the following terms:'],
   lease_sections=[('1. Property', 'The landlord lets the second-floor flat at 5 Rose Street, Bristol BS3 1QT, consisting of two bedrooms, living room, kitchen, bathroom and balcony (approx. 74 m²).'),
                   ('2. Term', 'The tenancy starts on November 1, 2026 and continues on a monthly basis. Either party may end it by giving notice as required by law.'),
                   ('3. Rent', 'The monthly rent is £1,150.00, payable in advance on or before the first day of each month by bank transfer.'),
                   ('4. Deposit', 'The tenant pays a deposit of £1,300.00, which is protected in a government-approved deposit scheme.'),
                   ('5. Repairs', 'The flat is handed over freshly decorated. The tenant reports any damage promptly; minor repairs up to £80 are paid by the tenant.'),
                   ('6. Pets', 'Small pets are allowed. Other pets require the prior written consent of the landlord.')],
   sign_place='Bristol, October 5, 2026', sign_l='Landlord', sign_r='Tenant',
   cv_file='CV_Anna_Berger.docx', cv_title='Curriculum Vitae', cv_sub='Anna Berger · Project Manager',
   cv_contact='12 Linden Road, Bristol BS6 5AA · anna.berger@example.com · 07700 900000',
   cv_h=['Experience', 'Education', 'Skills'],
   cv_exp=[('since 03/2022', 'Project Manager, Solar Systems West Ltd.', 'Leading client projects with teams of up to 12 people, budget responsibility, digital workflows.'),
           ('09/2018 – 02/2022', 'Project Assistant, City Utilities Bristol', 'Planning and coordinating construction projects, reporting and scheduling.')],
   cv_edu=[('2014 – 2018', 'BA Business Administration, University of the West', 'Focus on project and process management')],
   cv_skills='Project planning · Spreadsheets · Presentations · German (fluent) · French (good)',
   xlsx_file='Monthly_Expenses_2026.xlsx', sheet='Expenses', months=[],
   xh=['Category', 'Aug', 'Sep', 'Oct'], chart_title='Expenses by month', total_lbl='Total',
   pptx_file='Solar_Park_Project.pptx', p_title='Solar Park Project', p_sub='Kick-off · October 2026',
   p2_title='Timeline', p2_items=['Planning and permits by December', 'Tendering in the first quarter', 'Construction from April 2027', 'Commissioning in autumn 2027'],
   scan_file='Scan_Letter.jpg', letter_from='Kessler & Son Property Management · 21 Station Road · Bristol BS1 2AB',
   letter_to=['Ms Anna Berger', '12 Linden Road', 'Bristol', 'BS6 5AA'], letter_date='Bristol, 28 September 2026',
   letter_subj='Notice: heating system maintenance',
   letter_body=['Dear Ms Berger,', '', 'On Tuesday, 14 October 2026, the heating system', 'at 12 Linden Road will be serviced between', '8:00 am and 12:00 noon. During this time, heating', 'and hot water will not be available.', '', 'Please make sure the radiators in your flat', 'are accessible. If you have any questions,', 'please call us on 0117 000 0000.', '', 'Thank you for your understanding.', '', 'Kind regards,', 'Thomas Kessler'],
 ),
}

INK = HexColor('#1F2240'); ACC = HexColor('#3B37A0'); MUT = HexColor('#6B7090')


def wrap(c, text, font, size, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if c.stringWidth(t, font, size) > width: lines.append(cur); cur = w
        else: cur = t
    if cur: lines.append(cur)
    return lines


def invoice(t, path):
    W, H = A4
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(t['inv_title'])
    c.setFillColor(ACC); c.rect(0, H - 14, W, 14, stroke=0, fill=1)
    c.setFillColor(INK); c.setFont('Helvetica-Bold', 17); c.drawString(50, H - 70, t['company'])
    c.setFont('Helvetica', 9.5); c.setFillColor(MUT); c.drawString(50, H - 86, t['company_addr'])
    c.setFillColor(INK); c.setFont('Helvetica', 11)
    for i, l in enumerate(t['to']): c.drawString(50, H - 150 - i * 15, l)
    c.setFont('Helvetica-Bold', 26); c.setFillColor(ACC); c.drawRightString(W - 50, H - 150, t['inv_title'])
    c.setFont('Helvetica', 10); c.setFillColor(INK)
    for i, (k, v) in enumerate([(t['inv_no'], '2026-0412'), (t['inv_date'], t['date']), (t['due'], t['duedate'])]):
        c.setFillColor(MUT); c.drawRightString(W - 140, H - 175 - i * 15, k); c.setFillColor(INK); c.drawRightString(W - 50, H - 175 - i * 15, v)
    y = H - 260
    c.setFillColor(HexColor('#EEEEF9')); c.rect(50, y - 6, W - 100, 22, stroke=0, fill=1)
    c.setFillColor(INK); c.setFont('Helvetica-Bold', 9.5)
    xs = [58, 90, 330, 445, W - 58]
    for i, col in enumerate(t['cols']):
        (c.drawRightString if i >= 3 else c.drawString)(xs[i], y, col)
    c.setFont('Helvetica', 10)
    net = 0
    for n, (d, q, p) in enumerate(t['items'], 1):
        y -= 28
        qty = float(q.split()[0])
        tot = qty * p; net += tot
        c.drawString(xs[0], y, str(n)); c.drawString(xs[1], y, d); c.drawString(xs[2], y, q)
        c.drawRightString(xs[3], y, t['money'](p)); c.drawRightString(xs[4], y, t['money'](tot))
        c.setStrokeColor(HexColor('#E3E4F0')); c.line(50, y - 9, W - 50, y - 9)
    rate = 0.19 if t['inv_title'] == 'Rechnung' else 0.20
    y -= 40
    for k, v, b in [(t['net'], net, False), (t['vat'], net * rate, False), (t['total'], net * (1 + rate), True)]:
        c.setFont('Helvetica-Bold' if b else 'Helvetica', 12 if b else 10)
        c.drawRightString(xs[3], y, k); c.drawRightString(xs[4], y, t['money'](v)); y -= 20
    c.setFont('Helvetica', 10); c.setFillColor(INK)
    y -= 30
    for l in wrap(c, t['thanks'], 'Helvetica', 10, W - 100): c.drawString(50, y, l); y -= 14
    c.setFillColor(MUT); c.setFont('Helvetica', 8.5); c.drawString(50, 50, t['company'] + ' · ' + t['bank'])
    c.save()


def lease(t, path):
    W, H = A4
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(t['lease_title'])
    c.setFillColor(INK); c.setFont('Helvetica-Bold', 19); c.drawCentredString(W / 2, H - 70, t['lease_title'])
    y = H - 110
    c.setFont('Helvetica', 10.5)
    for l in t['lease_parties']:
        for ll in wrap(c, l, 'Helvetica', 10.5, W - 110): c.drawString(55, y, ll); y -= 15
        y -= 3
    y -= 8
    for h_, body in t['lease_sections']:
        c.setFont('Helvetica-Bold', 11.5); c.drawString(55, y, h_); y -= 16
        c.setFont('Helvetica', 10.5)
        for ll in wrap(c, body, 'Helvetica', 10.5, W - 110): c.drawString(55, y, ll); y -= 14.5
        y -= 10
    assert y > 240, y
    c.drawString(55, 215, t['sign_place'])
    y = 150  # signature line at a fixed height (store screenshots place the signature relative to it)
    c.setStrokeColor(INK); c.line(55, y, 245, y); c.line(W - 245, y, W - 55, y)
    c.setFont('Helvetica', 9.5); c.setFillColor(MUT)
    c.drawString(55, y - 14, t['sign_l']); c.drawString(W - 245, y - 14, t['sign_r'])
    c.setFont('Helvetica', 8); c.drawCentredString(W / 2, 40, '1 / 1')
    c.save()


def cv(t, path):
    d = docx.Document()
    st = d.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(11)
    h = d.add_heading(t['cv_title'], level=0)
    p = d.add_paragraph(); r = p.add_run(t['cv_sub']); r.bold = True; r.font.size = Pt(13); r.font.color.rgb = RGBColor(0x3B, 0x37, 0xA0)
    d.add_paragraph(t['cv_contact'])
    d.add_heading(t['cv_h'][0], level=1)
    for when, what, desc in t['cv_exp']:
        p = d.add_paragraph(); r = p.add_run(when + '   '); r.font.color.rgb = RGBColor(0x6B, 0x70, 0x90); r2 = p.add_run(what); r2.bold = True
        d.add_paragraph(desc)
    d.add_heading(t['cv_h'][1], level=1)
    for when, what, desc in t['cv_edu']:
        p = d.add_paragraph(); r = p.add_run(when + '   '); r.font.color.rgb = RGBColor(0x6B, 0x70, 0x90); r2 = p.add_run(what); r2.bold = True
        d.add_paragraph(desc)
    d.add_heading(t['cv_h'][2], level=1)
    d.add_paragraph(t['cv_skills'])
    d.save(path)


def sheet(t, path):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = t['sheet']
    ws.append(t['xh'])
    if t['sheet'] == 'Haushalt':
        inc = [2850, 2850, 2900, 2850, 3120, 2850, 2850, 2980]
        exp = [2310, 2140, 2560, 2290, 2480, 2950, 2390, 2240]
        for i, m in enumerate(t['months']):
            r = i + 2
            ws.append([m, inc[i], exp[i], f'=B{r}-C{r}'])
        n = len(t['months']) + 1
        ws.append([t['total_lbl'], f'=SUM(B2:B{n})', f'=SUM(C2:C{n})', f'=SUM(D2:D{n})'])
        fmt = '#,##0 €'; last_col = 3; anchor = 'A10'; chh = 5.6
    else:
        rows = [('Groceries', 410, 385, 432), ('Transport', 160, 172, 148), ('Utilities', 185, 179, 196), ('Leisure', 220, 265, 190), ('Phone', 35, 35, 35), ('Savings', 300, 300, 350)]
        for r_ in rows: ws.append(list(r_))
        n = len(rows) + 1
        fmt = '"£"#,##0'; last_col = 4; anchor = 'A9'; chh = 6.0
    ws.append([])
    for cell in ws[1]: cell.font = Font(bold=True)
    for row in ws.iter_rows(min_row=2, min_col=2, max_col=4):
        for cell in row: cell.number_format = fmt
    if t['sheet'] == 'Haushalt':
        for cell in ws[n + 1]: cell.font = Font(bold=True)
    ws.column_dimensions['A'].width = 11
    for col in 'BCD': ws.column_dimensions[col].width = 10
    ch = BarChart(); ch.type = 'col'; ch.title = t['chart_title']
    data = Reference(ws, min_col=2, min_row=1, max_col=last_col, max_row=n)
    cats = Reference(ws, min_col=1, min_row=2, max_row=n)
    ch.add_data(data, titles_from_data=True); ch.set_categories(cats)
    ch.width = 7.8; ch.height = chh; ch.legend.position = 'b'
    ws.add_chart(ch, anchor)
    wb.save(path)


def slides(t, path):
    pr = pptx.Presentation(); pr.slide_width = Inches(13.333); pr.slide_height = Inches(7.5)
    s = pr.slides.add_slide(pr.slide_layouts[6])
    bg = s.background.fill; bg.solid(); bg.fore_color.rgb = PRGB(0x1E, 0x1B, 0x5E)
    tb = s.shapes.add_textbox(Inches(0.9), Inches(2.6), Inches(11.5), Inches(1.4)); p = tb.text_frame.paragraphs[0]
    p.text = t['p_title']; p.font.size = PPt(54); p.font.bold = True; p.font.color.rgb = PRGB(255, 255, 255)
    tb = s.shapes.add_textbox(Inches(0.9), Inches(4.0), Inches(11.5), Inches(0.8)); p = tb.text_frame.paragraphs[0]
    p.text = t['p_sub']; p.font.size = PPt(26); p.font.color.rgb = PRGB(0x2D, 0xD4, 0xBF)
    s = pr.slides.add_slide(pr.slide_layouts[6])
    tb = s.shapes.add_textbox(Inches(0.9), Inches(0.7), Inches(11.5), Inches(1)); p = tb.text_frame.paragraphs[0]
    p.text = t['p2_title']; p.font.size = PPt(40); p.font.bold = True; p.font.color.rgb = PRGB(0x1E, 0x1B, 0x5E)
    tb = s.shapes.add_textbox(Inches(0.9), Inches(2.0), Inches(11.5), Inches(4.5)); tf = tb.text_frame
    for i, it in enumerate(t['p2_items']):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph(); p.text = '• ' + it; p.font.size = PPt(26); p.font.color.rgb = PRGB(0x33, 0x36, 0x55)
    pr.save(path)


def font(sz, bold=False):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', sz)


def letter_image(t):
    W, H = 1240, 1754
    im = Image.new('RGB', (W, H), (252, 251, 248)); d = ImageDraw.Draw(im)
    d.text((110, 110), t['letter_from'], fill=(90, 90, 100), font=font(20))
    d.line((110, 140, W - 110, 140), fill=(160, 160, 170), width=2)
    y = 230
    for l in t['letter_to']: d.text((110, y), l, fill=(25, 25, 30), font=font(30)); y += 42
    d.text((W - 110, 480), t['letter_date'], fill=(25, 25, 30), font=font(28), anchor='ra')
    d.text((110, 590), t['letter_subj'], fill=(15, 15, 20), font=font(32, True))
    y = 680
    for l in t['letter_body']:
        d.text((110, y), l, fill=(25, 25, 30), font=font(30)); y += 46
    return im


def desk(W, H, seed=3):
    rng = np.random.default_rng(seed)
    base = np.zeros((H, W, 3), np.float32)
    # warm wooden-ish table: horizontal grain
    yy = np.linspace(0, 1, H)[:, None]; xx = np.linspace(0, 1, W)[None, :]
    warp = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 60) * 40
    grain = (np.sin(yy * 140 + xx * 8 + warp) * 0.5 + 0.5)
    noise = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 2)
    fine = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (1, 0), sigmaX=25, sigmaY=1.2)
    v = 0.56 + 0.035 * grain + 0.02 * noise + 0.6 * fine
    base[..., 0] = v * 120; base[..., 1] = v * 160; base[..., 2] = v * 205  # BGR
    vign = 1 - 0.35 * (((xx - 0.5) ** 2 + (yy - 0.45) ** 2) * 2.2)
    return np.clip(base * vign[..., None], 0, 255)


def scan_photo(t, path, W=1440, H=1920):
    page = cv2.cvtColor(np.array(letter_image(t)), cv2.COLOR_RGB2BGR).astype(np.float32)
    ph, pw = page.shape[:2]
    bg = desk(W, H)
    dst = np.float32([[250, 290], [1205, 250], [1290, 1640], [175, 1660]])
    src = np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(page, M, (W, H), flags=cv2.INTER_AREA)
    mask = cv2.warpPerspective(np.ones((ph, pw), np.float32), M, (W, H))
    shadow = cv2.GaussianBlur(cv2.warpPerspective(np.ones((ph, pw), np.float32), M, (W, H)), (0, 0), 25)
    shadow = np.roll(shadow, (18, 12), (0, 1))
    out = bg * (1 - 0.45 * shadow[..., None])
    # light falloff on the paper
    yy = np.linspace(0, 1, H)[:, None]; xx = np.linspace(0, 1, W)[None, :]
    light = (0.97 - 0.12 * xx - 0.06 * yy)[..., None]
    out = out * (1 - mask[..., None]) + warped * light * mask[..., None]
    rng = np.random.default_rng(1)
    out += rng.normal(0, 2.2, out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    cv2.imwrite(str(path), out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return out


def y4m(img_bgr, path, w=1280, h=720, frames=30):
    # landscape camera frame: rotate portrait photo to fit like a phone camera stream would (we use portrait 720x1280)
    im = cv2.resize(img_bgr, (w, h), interpolation=cv2.INTER_AREA)
    yuv = cv2.cvtColor(im, cv2.COLOR_BGR2YUV_I420)
    with open(path, 'wb') as f:
        f.write(f'YUV4MPEG2 W{w} H{h} F30:1 Ip A1:1 C420jpeg\n'.encode())
        for _ in range(frames): f.write(b'FRAME\n'); f.write(yuv.tobytes())


if __name__ == '__main__':
    for lang, t in T.items():
        o = OUT / lang; o.mkdir(parents=True, exist_ok=True)
        invoice(t, o / t['inv_file'])
        lease(t, o / t['lease_file'])
        cv(t, o / t['cv_file'])
        sheet(t, o / t['xlsx_file'])
        slides(t, o / t['pptx_file'])
        img = scan_photo(t, o / t['scan_file'])
        y4m(img, o / 'camera.y4m', 720, 960)
        print(lang, sorted(p.name for p in o.iterdir()))
