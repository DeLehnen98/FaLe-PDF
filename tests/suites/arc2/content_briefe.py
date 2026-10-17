"""arc2 content: letter pages (Brief- und Schreiben-Vorlagen). Generic contract types, fictional people and firms."""
import json, sys
from pathlib import Path
OUT = Path('/home/claude/FalePDF/network/tools/vorlagen/briefe')
OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.json'):
    f.unlink()
ORDER = [0]

JANA = ['Jana Beispiel', 'Lindenstraße 12', '66111 Saarbrücken']
MARKUS = ['Markus Probe', 'Am Kirchberg 3', '54290 Trier']
SEVGI = ['Sevgi Arslan', 'Hafenstraße 21', '28217 Bremen']
THOMAS = ['Thomas Muster', 'Birkenallee 8', '34117 Kassel']
KATRIN = ['Katrin Neumann', 'Rosenweg 14', '79098 Freiburg im Breisgau']
LUKAS = ['Lukas Wagner', 'Schillerstraße 40', '04109 Leipzig']


def B(id, group, tool, name, short, desc, when, must, notes, faq, fields, related=(), search='', frm=None, to=None, letter=None, doc=None, doc_intro='',
      paper=False, mail=False, h1=None, lede=None, en=None):
    ORDER[0] += 1
    d = {'id': id, 'group': group, 'tool': tool, 'order': ORDER[0], 'name': name, 'short': short, 'desc': desc, 'search': search, 'when': when, 'must': must,
         'notes': notes, 'faq': [{'q': q, 'a': a} for q, a in faq], 'fields': fields, 'related': list(related)}
    for k, v in (('from', frm), ('to', to), ('letter', letter), ('doc', doc), ('h1', h1), ('lede', lede), ('en', en)):
        if v:
            d[k] = v
    if doc_intro:
        d['doc_intro'] = doc_intro
    if paper:
        d['paper'] = True
    if mail:
        d['mail'] = True
    if not 110 <= len(desc) <= 180:
        print(f'{id}: desc length {len(desc)}', file=sys.stderr)
    (OUT / f'{id}.json').write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def C(type, **kw):
    """cancellation-letter fields"""
    return {'type': type, 'when': 'next', 'confirm': True, 'sepa': True, 'gdpr': False, 'noAds': False, **kw}


def L(subject, body, salutation='Sehr geehrte Damen und Herren,', closing='Mit freundlichen Grüßen', att=(), notice=''):
    x = {'subject': subject, 'salutation': salutation, 'body': body, 'closing': closing, 'att': list(att)}
    if notice:
        x['notice'] = notice
    return x


SEND = 'Schick die Kündigung so, dass du den Zugang beweisen kannst, und heb den Beleg auf.'

# ================================================================== Kündigungen
B('kuendigung-handyvertrag', 'kuendigung', 'cancellation-letter', 'Kündigung Handyvertrag', 'Mobilfunkvertrag kündigen, Rufnummer mitnehmen',
  'Kündigung für den Handyvertrag als Vorlage: mit Kundennummer, Rufnummer und Wunsch zur Rufnummernmitnahme – erklärt, ausgefüllt und direkt als PDF speichern.',
  ['Du willst den Anbieter wechseln, brauchst den Vertrag nicht mehr oder die Mindestlaufzeit endet bald. Läuft der Vertrag nach der Mindestlaufzeit stillschweigend weiter, kannst du ihn in der Regel mit einer Frist von einem Monat kündigen.',
   'Wenn du deine Nummer behalten willst, steht der Wunsch zur Rufnummernmitnahme gleich mit im Brief. Den Wechsel selbst beauftragst du beim neuen Anbieter.'],
  ['Deinen Namen und deine Anschrift, wie sie beim Anbieter hinterlegt sind', 'Kundennummer und die Rufnummer, um die es geht', 'Den Kündigungszeitpunkt – „zum nächstmöglichen Zeitpunkt“ ist am sichersten', 'Die Bitte um eine schriftliche Bestätigung mit Vertragsende', 'Falls gewünscht: Rufnummernmitnahme und Widerruf der Lastschrift'],
  ['Online abgeschlossene Verträge kannst du auch über den Kündigungsbutton auf der Website des Anbieters kündigen. Mach dann einen Screenshot der Bestätigung.', 'Die Rufnummer kannst du auch während der Vertragslaufzeit mitnehmen; der alte Vertrag läuft dann bis zum Ende weiter und kostet weiter Grundgebühr.', SEND],
  [('Darf mich der Anbieter nach der Kündigung anrufen?', 'Viele Anbieter melden sich mit einem „Rückholangebot“. Wenn du das nicht willst, setz in der Vorlage den Haken „Rückgewinnungs-Anrufe untersagen“.'),
   ('Muss ich einen Grund angeben?', 'Nein. Eine ordentliche Kündigung braucht keinen Grund. Nur bei einer außerordentlichen Kündigung, etwa nach einer Preiserhöhung, nennst du den Anlass.')],
  C('handy', customer='4711-2026-88', phone='0151 23456789', port=True, noAds=True),
  ['kuendigung-internetvertrag', 'kuendigungsbestaetigung-anfordern', 'kuendigung-streaming'], 'mobilfunk handy smartphone vertrag rufnummer',
  frm=JANA, to={'org': 'Beispielfunk Mobil GmbH', 'attn': 'Kundenservice', 'street': 'Postfach 10 11 12', 'city': '40001 Düsseldorf'})

B('kuendigung-internetvertrag', 'kuendigung', 'cancellation-letter', 'Kündigung Internetvertrag', 'DSL-, Kabel- oder Glasfaservertrag kündigen',
  'Kündigung für den Internetvertrag (DSL, Kabel, Glasfaser) als Muster: Kundennummer, Vertragsnummer, Router-Rückgabe – vorausgefüllt und als PDF fürs Fensterkuvert.',
  ['Du ziehst um, wechselst zu einem schnelleren Anschluss oder brauchst den Vertrag nicht mehr. Nach der Mindestlaufzeit sind die meisten Internetverträge mit einem Monat Frist kündbar.',
   'Der Brief fragt gleich mit, ob und wohin du den Router oder andere Leihgeräte zurückschicken sollst – sonst stellt dir der Anbieter sie später oft in Rechnung.'],
  ['Kundennummer und, wenn vorhanden, Vertragsnummer', 'Anschlussadresse oder Rufnummer des Anschlusses', 'Kündigungszeitpunkt', 'Frage nach der Rückgabe überlassener Geräte', 'Bitte um Bestätigung'],
  ['Beim Umzug gibt es ein Sonderkündigungsrecht, wenn der Anbieter am neuen Wohnort die vereinbarte Leistung nicht liefern kann. Dann gilt in der Regel eine Frist von einem Monat ab dem Auszug.', 'Willst du den Anbieter wechseln, beauftrage den Wechsel beim neuen Anbieter – der kümmert sich oft auch um die Kündigung, und du bist ohne Unterbrechung online.', SEND],
  [('Was passiert mit meiner Festnetznummer?', 'Die kannst du zum neuen Anbieter mitnehmen. Gib das beim neuen Anbieter an; der alte Anbieter muss die Nummer freigeben.'),
   ('Muss ich den Router zurückschicken?', 'Nur wenn er gemietet oder geliehen war. Ein gekaufter Router gehört dir. Im Zweifel steht es im Vertrag oder auf der Rechnung.')],
  C('internet', customer='800 123 456', contract='V-2023-55821', line='Lindenstraße 12, Saarbrücken'),
  ['kuendigung-handyvertrag', 'kuendigung-strom', 'kuendigungsbestaetigung-anfordern'], 'dsl kabel glasfaser internet router',
  frm=JANA, to={'org': 'Netzwerk Muster AG', 'attn': 'Kündigungen', 'street': 'Postfach 20 30 40', 'city': '50667 Köln'})

B('kuendigung-strom', 'kuendigung', 'cancellation-letter', 'Kündigung Stromvertrag', 'Stromliefervertrag kündigen, Schlussrechnung anfordern',
  'Vorlage zur Kündigung des Stromvertrags: Kundennummer, Zählernummer, Bitte um Schlussrechnung – mit Hinweisen zu Fristen, Umzug und Preiserhöhung. Als PDF ausfüllen.',
  ['Du ziehst aus, hast einen günstigeren Tarif gefunden oder der Versorger hat die Preise erhöht. In der Grundversorgung beträgt die Frist meist zwei Wochen; bei Sonderverträgen steht sie im Vertrag.',
   'Beim Wechsel zu einem neuen Anbieter übernimmt meist der neue Anbieter die Kündigung. Selbst kündigen musst du vor allem beim Umzug oder wenn du den Wechsel selbst in der Hand behalten willst.'],
  ['Kundennummer und Zählernummer', 'Den Kündigungszeitpunkt – beim Umzug am besten den Auszugstag', 'Zählerstand mit Ablesedatum, wenn du schon abgelesen hast', 'Die Bitte um die Schlussrechnung an deine (neue) Anschrift', 'Widerruf der Einzugsermächtigung'],
  ['Nach einer Preiserhöhung hast du ein Sonderkündigungsrecht. Die Frist dafür steht im Schreiben zur Preisänderung – nicht zu lange warten.', 'Fotografier den Zähler beim Auszug mit Datum. So kannst du deinen Verbrauch später belegen.', SEND],
  [('Bleibe ich ohne Strom, wenn ich kündige und keinen neuen Vertrag habe?', 'Nein. Wer ohne Vertrag Strom bezieht, wird automatisch vom Grundversorger beliefert – allerdings meist zu höheren Preisen. Schließ also rechtzeitig einen neuen Vertrag ab.')],
  C('energy', customer='1002-334455', meter='1APA0123456789'),
  ['kuendigung-gas', 'kuendigung-mietvertrag', 'kuendigung-internetvertrag'], 'strom energie versorger umzug zähler',
  frm=MARKUS, to={'org': 'Stadtwerke Musterstadt GmbH', 'attn': 'Kundenservice Energie', 'street': 'Werkstraße 1', 'city': '54292 Trier'})

B('kuendigung-gas', 'kuendigung', 'cancellation-letter', 'Kündigung Gasvertrag', 'Gasliefervertrag kündigen, Zählerstand mitteilen',
  'Gasvertrag kündigen mit Vorlage: Kundennummer, Zählernummer und Bitte um Schlussrechnung – mit Infos zu Grundversorgung, Sonderkündigung und Umzug. Kostenlos als PDF.',
  ['Du ziehst um, wechselst den Anbieter oder baust auf eine andere Heizung um. Die Frist hängt vom Vertrag ab: in der Grundversorgung meist zwei Wochen, bei Sonderverträgen steht sie im Vertrag.',
   'Wohnst du zur Miete und der Vermieter liefert die Wärme über die Nebenkosten, hast du keinen eigenen Gasvertrag – dann brauchst du diese Kündigung nicht.'],
  ['Kundennummer und Zählernummer des Gaszählers', 'Kündigungszeitpunkt', 'Zählerstand mit Datum, sobald du ihn hast', 'Schlussrechnung an die neue Adresse', 'Widerruf der Lastschrift'],
  ['Gaszähler zeigen Kubikmeter. Der Versorger rechnet sie mit Brennwert und Zustandszahl in kWh um – deshalb stimmt deine eigene Rechnung selten auf den Cent.', 'Nach einer Preiserhöhung kannst du außerordentlich kündigen. Wähl dann in der Vorlage „Außerordentliche Kündigung“ mit dem Grund „Preiserhöhung“.', SEND],
  [('Wann sollte ich den Zählerstand ablesen?', 'Am Auszugstag oder am letzten Liefertag. Schreib den Stand mit Datum auf und mach ein Foto; die Vorlage kann ihn in den Brief übernehmen.')],
  C('energy', customer='GAS-77 0012 45', meter='7GMT0042113'),
  ['kuendigung-strom', 'kuendigung-mietvertrag', 'maengelanzeige-wohnung'], 'gas heizung energie zähler',
  frm=MARKUS, to={'org': 'Beispielgas Energie GmbH', 'attn': 'Vertragsservice', 'street': 'Postfach 12 34', 'city': '54203 Trier'})

B('kuendigung-fitnessstudio', 'kuendigung', 'cancellation-letter', 'Kündigung Fitnessstudio', 'Mitgliedschaft im Fitnessstudio kündigen',
  'Fitnessstudio kündigen mit Vorlage: Mitgliedsnummer, Standort, Kündigung zum nächstmöglichen Termin – mit ehrlichen Infos zu Fristen und Sonderkündigung. Als PDF.',
  ['Du trainierst nicht mehr, ziehst weg oder willst das Studio wechseln. Bei Verträgen, die seit März 2022 geschlossen wurden, gilt nach der Erstlaufzeit meist: Die Mitgliedschaft verlängert sich nur noch auf unbestimmte Zeit und ist dann monatlich kündbar.',
   'Bei älteren Verträgen steht die Frist im Vertrag oder in den Bedingungen des Studios.'],
  ['Mitgliedsnummer und, bei Ketten, den Standort', 'Kündigung zum nächstmöglichen Zeitpunkt', 'Bitte um schriftliche Bestätigung mit dem genauen Ende', 'Widerruf der Lastschrift zum Vertragsende'],
  ['Ein Umzug ist nach der Rechtsprechung kein automatischer Grund für eine fristlose Kündigung beim Fitnessstudio. Eine ärztlich bescheinigte Krankheit, die das Training dauerhaft unmöglich macht, kann einer sein – lass dich dann beraten.', 'Viele Studios haben online einen Kündigungsbutton. Er ist genauso wirksam wie ein Brief.', SEND],
  [('Kann ich die Mitgliedschaft auch pausieren?', 'Manche Studios bieten eine Ruhezeit an, etwa bei Krankheit oder Schwangerschaft. Ob und wie lange, steht im Vertrag. Eine Pause verlängert die Laufzeit oft entsprechend.')],
  C('fitness', member='000815-24', site='Musterstadt-Mitte', noAds=True),
  ['kuendigung-verein', 'kuendigung-streaming', 'kuendigungsbestaetigung-anfordern'], 'fitness gym studio sport mitgliedschaft',
  frm=SEVGI, to={'org': 'FitMuster Studios GmbH', 'attn': 'Mitgliederverwaltung', 'street': 'Sportallee 5', 'city': '28195 Bremen'})

B('kuendigung-zeitschrift', 'kuendigung', 'cancellation-letter', 'Kündigung Zeitschriften-Abo', 'Abonnement einer Zeitschrift oder Zeitung kündigen',
  'Zeitschriften- oder Zeitungsabo kündigen: Vorlage mit Abo-Nummer und Titel, Kündigung zum nächstmöglichen Termin – vorausgefüllt und sofort als PDF fürs Kuvert.',
  ['Du liest die Zeitschrift nicht mehr oder ein Probeabo soll nicht in ein teures Jahresabo übergehen. Abos, die seit März 2022 abgeschlossen wurden, sind nach der Mindestlaufzeit in der Regel monatlich kündbar.',
   'Für ein Probeabo zählt die Frist aus dem Angebot – oft musst du schon vor der letzten Gratisausgabe kündigen.'],
  ['Titel der Zeitschrift', 'Abo- oder Kundennummer (steht auf dem Adressaufkleber)', 'Kündigungszeitpunkt', 'Bitte um Bestätigung', 'Widerruf der Lastschrift'],
  ['Bei Geschenkabos kündigt in der Regel die Person, die das Abo bezahlt.', 'Online abgeschlossene Abos lassen sich auch über den Kündigungsbutton auf der Verlagsseite kündigen.', SEND],
  [('Bekomme ich Geld zurück, wenn ich im Voraus bezahlt habe?', 'Endet das Abo vor dem Ende des bezahlten Zeitraums, muss der Verlag den Rest in der Regel erstatten. Frag in der Kündigung danach, falls du jährlich im Voraus zahlst.')],
  C('magazine', title='Beispiel Garten', subno='ABO-559 210'),
  ['kuendigung-streaming', 'kuendigung-verein', 'kuendigungsbestaetigung-anfordern'], 'zeitung zeitschrift magazin abo',
  frm=THOMAS, to={'org': 'Verlag Musterpresse GmbH', 'attn': 'Aboservice', 'street': 'Postfach 30 40 50', 'city': '34001 Kassel'})

B('kuendigung-streaming', 'kuendigung', 'cancellation-letter', 'Kündigung Streaming-Abo', 'Video-, Musik- oder Hörbuch-Abo kündigen',
  'Streaming-Abo kündigen, wenn es im Konto nicht klappt: Vorlage mit E-Mail-Adresse des Kontos und Kündigung zum Ende des bezahlten Zeitraums – als PDF oder Text.',
  ['Die meisten Streamingdienste kannst du direkt im Konto oder über den Kündigungsbutton auf der Website kündigen – das ist der schnellste Weg. Ein Brief ist sinnvoll, wenn das nicht klappt, das Konto gesperrt ist oder du einen Nachweis brauchst.',
   'Das Abo läuft in der Regel bis zum Ende des bezahlten Zeitraums weiter.'],
  ['Name des Dienstes', 'Die E-Mail-Adresse, mit der das Konto angelegt ist', 'Kunden- oder Abonummer, falls vorhanden', 'Kündigung zum nächstmöglichen Zeitpunkt', 'Bitte um Bestätigung'],
  ['Hast du das Abo über einen App-Store abgeschlossen, kündigst du es dort in den Abo-Einstellungen – der Dienst selbst kann es oft nicht beenden.', 'Achte bei Paketen mit dem Handy- oder Internetvertrag darauf, wer der Vertragspartner ist.', SEND],
  [('Was passiert mit meinen Daten nach der Kündigung?', 'Wenn du willst, dass das Konto gelöscht wird, setz in der Vorlage den Haken „Löschung meiner Daten verlangen (Art. 17 DSGVO)“.')],
  C('streaming', service='StreamMuster', account='jana.beispiel@example.com', gdpr=True),
  ['kuendigung-zeitschrift', 'dsgvo-loeschung', 'kuendigung-handyvertrag'], 'netflix spotify video musik hörbuch abo',
  frm=JANA, to={'org': 'StreamMuster Europe B.V.', 'attn': 'Kundenservice', 'street': 'Musterkade 12', 'city': '1011 AB Amsterdam', 'country': ''})

for ident, kind, kname, short, desc, when2, extra_note, faq_q, faq_a, srch, policy, rel in [
    ('kuendigung-kfz-versicherung', 'Kfz-Versicherung', 'Kündigung Kfz-Versicherung', 'Autoversicherung zum Ablauf oder nach Verkauf kündigen',
     'Kfz-Versicherung kündigen mit Muster: Versicherungsnummer, Kündigung zum Ablauf des Versicherungsjahres – mit Hinweisen zu Stichtag, Wechsel und Sonderkündigung.',
     'Meist läuft das Versicherungsjahr mit dem Kalenderjahr, und die Kündigung muss einen Monat vorher ankommen – also bis zum 30. November. Nach einem Schaden oder einer Beitragserhöhung gibt es ein Sonderkündigungsrecht. Beim Verkauf des Autos geht die Versicherung zunächst auf den Käufer über; er oder du kann sie dann kündigen.',
     'Ein zugelassenes Auto muss immer versichert sein. Kündigst du ohne neue Versicherung, meldet der Versicherer das der Zulassungsstelle. Beim Wechsel kündigt oft die neue Versicherung für dich – frag dort nach.',
     'Was ist mit dem Schadenfreiheitsrabatt?', 'Der Schadenfreiheitsrabatt geht mit dir zur neuen Versicherung. Der alte Versicherer übermittelt ihn auf Anfrage des neuen.',
     'auto kfz versicherung wechsel stichtag', 'KH-12 345 678-9', ['kuendigung-haftpflichtversicherung', 'vollmacht-kfz-zulassung', 'kuendigungsbestaetigung-anfordern']),
    ('kuendigung-haftpflichtversicherung', 'Privathaftpflichtversicherung', 'Kündigung Haftpflichtversicherung', 'Private Haftpflicht kündigen oder wechseln',
     'Haftpflichtversicherung kündigen: Vorlage mit Versicherungsnummer, Kündigung zum Ablauf, Bitte um Bestätigung – mit Tipps, damit keine Lücke im Schutz entsteht.',
     'Die Frist steht im Versicherungsschein, häufig drei Monate zum Ende des Versicherungsjahres. Nach einem Schadenfall oder einer Beitragserhöhung kannst du oft außerordentlich kündigen. Die genauen Fristen dafür stehen in den Versicherungsbedingungen.',
     'Schließ die neue Haftpflicht ab, bevor du die alte kündigst. Eine Lücke von auch nur einem Tag kann teuer werden, wenn genau dann etwas passiert.',
     'Brauche ich nach dem Zusammenziehen zwei Haftpflichtversicherungen?', 'Paare und Familien können meist einen gemeinsamen Vertrag haben. Dann kündigt eine Person ihren Einzelvertrag, oft mit Sonderkündigungsrecht wegen Wegfall des Risikos – frag bei beiden Versicherern nach.',
     'haftpflicht versicherung privat', 'PHV-2019-554433', ['kuendigung-hausratversicherung', 'kuendigung-kfz-versicherung', 'kuendigungsbestaetigung-anfordern']),
    ('kuendigung-hausratversicherung', 'Hausratversicherung', 'Kündigung Hausratversicherung', 'Hausrat kündigen, z. B. nach Umzug oder Wechsel',
     'Hausratversicherung kündigen mit Vorlage: Versicherungsnummer, Kündigung zum Ablauf, Hinweise zum Umzug und zur Sonderkündigung – direkt als PDF ausfüllen.',
     'In der Regel gilt eine Frist von drei Monaten zum Ende des Versicherungsjahres. Ziehst du um, geht die Versicherung meist mit in die neue Wohnung; erhöht sich dadurch der Beitrag, kannst du oft kündigen. Auch nach einem Schaden gibt es ein Sonderkündigungsrecht.',
     'Prüf vor dem Kündigen die Versicherungssumme der neuen Police: Sie sollte zum Wert deines Hausrats passen. Die Inventarliste hilft beim Schätzen.',
     'Was passiert, wenn zwei Haushalte zusammenziehen?', 'Dann gibt es oft zwei Hausratversicherungen für eine Wohnung. Ein Vertrag kann meist wegen Doppelversicherung angepasst oder beendet werden – sprich mit beiden Versicherern.',
     'hausrat versicherung umzug', 'HR 77-221-005', ['kuendigung-haftpflichtversicherung', 'kuendigung-mietvertrag', 'kuendigungsbestaetigung-anfordern']),
]:
    B(ident, 'kuendigung', 'cancellation-letter', kname, short, desc,
      [f'Du wechselst zu einem günstigeren Tarif, brauchst die {kind} nicht mehr oder willst nach einem Ärgernis weg. {when2}'],
      ['Versicherungsnummer (steht auf dem Versicherungsschein)', 'Art der Versicherung', 'Kündigung zum Ablauf des Versicherungsjahres – oder zum nächstmöglichen Zeitpunkt', 'Bitte um schriftliche Bestätigung mit dem Vertragsende', 'Widerruf der Lastschrift'],
      [extra_note, 'Für eine außerordentliche Kündigung nach Beitragserhöhung oder Schaden setzt du in der Vorlage den Haken „Außerordentliche Kündigung“ und wählst den Grund.', SEND],
      [(faq_q, faq_a), ('Reicht eine E-Mail?', 'Bei vielen Versicherungen reicht heute die Textform, also auch eine E-Mail. Ein Brief per Einschreiben ist trotzdem der sicherste Nachweis, dass deine Kündigung rechtzeitig angekommen ist.')],
      C('insurance', kind=kind, policy=policy), rel, srch,
      frm=LUKAS, to={'org': 'Musterversicherung AG', 'attn': 'Vertragsabteilung', 'street': 'Postfach 40 50 60', 'city': '04001 Leipzig'})

B('kuendigung-mietvertrag', 'kuendigung', 'cancellation-letter', 'Kündigung Mietvertrag (Mieter)', 'Wohnung als Mieter fristgerecht kündigen',
  'Mietvertrag kündigen als Mieter: Muster mit Kündigungsfrist, Übergabetermin und Kaution – inklusive Frist-Rechner und Hinweis zur Unterschrift auf Papier.',
  ['Du ziehst aus und musst deine Mietwohnung kündigen. Für Mieter gilt bei unbefristeten Verträgen in der Regel eine Frist von drei Monaten. Die Kündigung muss spätestens am dritten Werktag eines Monats beim Vermieter ankommen, damit dieser Monat mitzählt.',
   'Die Vorlage rechnet das voraussichtliche Ende aus dem Tag aus, an dem der Brief ankommt, und bittet gleich um einen Übergabetermin und die Abrechnung der Kaution.'],
  ['Die Anschrift der Wohnung und die Lage (z. B. 2. OG links)', 'Die Namen aller Mieterinnen und Mieter, die im Vertrag stehen – alle müssen unterschreiben', 'Kündigungszeitpunkt – „zum nächstmöglichen Termin“ ist am sichersten', 'Bitte um Termine für die Übergabe', 'Bitte um Abrechnung und Auszahlung der Kaution'],
  ['Stehen mehrere Personen im Mietvertrag, müssen alle kündigen und unterschreiben – sonst ist die Kündigung unwirksam.', 'Bei einem Zeitmietvertrag oder einem vereinbarten Kündigungsverzicht kannst du oft nicht vor einem bestimmten Datum kündigen. Lies deinen Vertrag genau.', 'Wirf den Brief selbst mit einer Zeugin ein oder schick ihn per Einwurf-Einschreiben – dann kannst du den Zugang belegen.'],
  [('Kann ich früher raus, wenn ich einen Nachmieter stelle?', 'Einen Anspruch darauf hast du nur, wenn es im Vertrag steht oder du einen besonderen Grund hast. Viele Vermieter lassen sich aber darauf ein – frag freundlich nach und schlag geeignete Nachmieter vor.'),
   ('Wann bekomme ich die Kaution zurück?', 'Der Vermieter darf sich einige Monate Zeit lassen, um Ansprüche zu prüfen, und einen Teil für die nächste Nebenkostenabrechnung einbehalten. Üblich sind drei bis sechs Monate.')],
  C('rent', object='Lindenstraße 12, 66111 Saarbrücken', floor='2. OG links', cotenants='', handover=True, deposit=True, iban=''),
  ['maengelanzeige-wohnung', 'vollmacht-wohnungsuebergabe', 'kuendigung-strom'], 'wohnung miete auszug vermieter',
  frm=JANA, to={'org': 'Hausverwaltung Muster & Partner', 'attn': 'Frau Weber', 'street': 'Bahnhofstraße 22', 'city': '66111 Saarbrücken'}, paper=True)

B('kuendigung-arbeitsvertrag', 'kuendigung', 'din-letter', 'Kündigung Arbeitsvertrag (Arbeitnehmer)', 'Als Arbeitnehmer kündigen – auf Papier mit Unterschrift',
  'Arbeitsvertrag kündigen als Arbeitnehmer: Muster mit Kündigungsfrist, Bitte um Arbeitszeugnis und Resturlaub – mit Hinweis, warum du auf Papier unterschreiben musst.',
  ['Du hast eine neue Stelle oder willst aus anderen Gründen gehen. Als Arbeitnehmer brauchst du für eine ordentliche Kündigung keinen Grund. Die gesetzliche Frist beträgt vier Wochen zum 15. oder zum Ende eines Kalendermonats; in deinem Arbeits- oder Tarifvertrag kann eine längere Frist stehen.',
   'Wichtig: Eine Kündigung des Arbeitsverhältnisses muss schriftlich sein – auf Papier, eigenhändig unterschrieben. Eine E-Mail, eine Nachricht im Chat oder ein Scan reichen nicht.'],
  ['Deinen Namen und, wenn vorhanden, deine Personalnummer', 'Den Satz, dass du das Arbeitsverhältnis kündigst, mit dem Datum – „hilfsweise zum nächstmöglichen Zeitpunkt“ fängt eine falsch berechnete Frist auf', 'Die Bitte um ein qualifiziertes Arbeitszeugnis', 'Einen Hinweis zum Resturlaub und zu Überstunden', 'Deine eigenhändige Unterschrift'],
  ['Übergib die Kündigung am besten persönlich und lass dir den Empfang auf einer Kopie mit Datum quittieren. Alternativ: Einwurf-Einschreiben.', 'Melde dich spätestens drei Monate vor dem Ende bei der Agentur für Arbeit arbeitssuchend, wenn du noch keine neue Stelle hast – sonst droht eine Sperrzeit.', 'In der Probezeit gilt oft eine Frist von zwei Wochen.'],
  [('Kann ich per E-Mail kündigen?', 'Nein. Für die Kündigung eines Arbeitsverhältnisses schreibt das Gesetz die Schriftform vor: Papier und deine Unterschrift mit Kugelschreiber. Druck das PDF aus und unterschreib es.'),
   ('Muss ich einen Grund nennen?', 'Nein. Du kannst einen Satz des Danks ergänzen, wenn du magst – nötig ist er nicht.')],
  {'notice': 'none'}, ['antrag-teilzeit', 'krankmeldung-email', 'kuendigungsbestaetigung-anfordern'], 'job arbeit stelle kündigen arbeitgeber',
  frm=SEVGI, to={'org': 'Muster Logistik GmbH', 'attn': 'Personalabteilung', 'street': 'Industriestraße 10', 'city': '28197 Bremen'},
  letter=L('Kündigung meines Arbeitsverhältnisses – Personalnummer 30418',
           ['hiermit kündige ich mein Arbeitsverhältnis fristgerecht zum [Datum], hilfsweise zum nächstmöglichen Zeitpunkt.',
            'Bitte stellen Sie mir ein qualifiziertes Arbeitszeugnis aus, das sich auf Leistung und Verhalten erstreckt. Meinen restlichen Urlaub von [Anzahl] Tagen möchte ich bis zum Ende des Arbeitsverhältnisses nehmen; einen Vorschlag für die Zeiträume schicke ich Ihnen gesondert.',
            'Für die Zusammenarbeit in den vergangenen Jahren bedanke ich mich. Bitte bestätigen Sie mir den Eingang dieser Kündigung und das Ende des Arbeitsverhältnisses schriftlich.']),
  paper=True)

B('kuendigung-verein', 'kuendigung', 'cancellation-letter', 'Kündigung Vereinsmitgliedschaft', 'Aus einem Verein austreten',
  'Austritt aus dem Verein mit Vorlage: Kündigung der Mitgliedschaft zum nächstmöglichen Termin, Mitgliedsnummer, Widerruf der Lastschrift – sofort als PDF.',
  ['Du nutzt das Angebot des Vereins nicht mehr, ziehst weg oder dein Kind hat aufgehört. Wie und wann du austreten kannst, regelt die Satzung des Vereins – oft zum Ende des Kalender- oder Geschäftsjahres mit einer Frist von einigen Wochen oder Monaten.'],
  ['Name des Mitglieds – bei Kindern auch dein Name als Elternteil', 'Mitgliedsnummer, falls vorhanden', 'Kündigung zum nächstmöglichen Zeitpunkt', 'Bitte um Bestätigung', 'Widerruf der Lastschrift zum Ende der Mitgliedschaft'],
  ['Schick die Kündigung an die Adresse, die in der Satzung oder auf der Website steht – meist der Vorstand oder die Geschäftsstelle, nicht die Trainerin.', 'Leihgaben wie Trikots oder Schlüssel gibst du am besten gegen Quittung zurück.', SEND],
  [('Wo finde ich die Kündigungsfrist?', 'In der Satzung des Vereins. Viele Vereine stellen sie auf ihre Website; sonst kannst du sie beim Vorstand anfordern.')],
  C('club', member='M-1187'), ['kuendigung-fitnessstudio', 'kuendigung-zeitschrift', 'kuendigungsbestaetigung-anfordern'], 'verein austritt sportverein mitgliedschaft',
  frm=THOMAS, to={'org': 'TV Musterdorf 1907 e. V.', 'attn': 'Vorstand', 'street': 'Am Sportplatz 1', 'city': '34128 Kassel'})

B('kuendigung-bausparvertrag', 'kuendigung', 'cancellation-letter', 'Kündigung Bausparvertrag', 'Bausparvertrag kündigen und Guthaben auszahlen lassen',
  'Bausparvertrag kündigen mit Musterschreiben: Vertragsnummer, Kündigung, Auszahlung des Guthabens – mit Hinweisen zu Kündigungsfrist, Gebühren und Alternativen.',
  ['Du brauchst das Guthaben für etwas anderes oder willst keinen Bausparkredit. Die Kündigungsfrist steht in den Bausparbedingungen, häufig drei Monate. Bei manchen Bausparkassen geht es gegen einen Abschlag schneller.',
   'Bevor du kündigst, lohnt ein Blick auf die Alternativen: Du kannst den Vertrag oft ruhen lassen, teilen oder die Bausparsumme herabsetzen.'],
  ['Vertragsnummer', 'Klare Kündigung des Bausparvertrags', 'Wohin das Guthaben überwiesen werden soll (IBAN)', 'Bitte um Bestätigung', 'Widerruf der Lastschrift für die Sparraten'],
  ['Die Abschlussgebühr bekommst du in der Regel nicht zurück. Rechne nach, ob sich ein Weitersparen bis zur Zuteilung doch lohnt.', 'Hast du staatliche Förderung (z. B. Wohnungsbauprämie) bekommen, kann eine vorzeitige Auszahlung Folgen haben – frag vorher nach.', SEND],
  [('Kann die Bausparkasse mir kündigen?', 'Ja, unter bestimmten Bedingungen, etwa wenn der Vertrag seit über zehn Jahren zuteilungsreif ist. Hier geht es um deine eigene Kündigung als Sparerin oder Sparer.')],
  C('other', thing='meinen Bausparvertrag Nr. 55 123 456', number='55 123 456'), ['kuendigung-kfz-versicherung', 'kuendigungsbestaetigung-anfordern', 'quittung-privatverkauf'], 'bausparen bausparkasse guthaben',
  frm=MARKUS, to={'org': 'Muster Bausparkasse AG', 'attn': 'Kundenservice', 'street': 'Postfach 50 60 70', 'city': '54203 Trier'})

B('kuendigung-kita-platz', 'kuendigung', 'cancellation-letter', 'Kündigung Kita-Platz', 'Betreuungsvertrag in Kita oder Krippe kündigen',
  'Kita-Platz kündigen mit Vorlage: Betreuungsvertrag, Name des Kindes, Kündigung zum nächstmöglichen Termin – mit Hinweisen zu Fristen in Satzung und Vertrag.',
  ['Ihr zieht um, euer Kind wechselt in eine andere Einrichtung oder kommt in die Schule. Bei städtischen Kitas regelt oft eine Satzung die Frist, bei freien Trägern der Betreuungsvertrag – häufig ein bis drei Monate zum Monatsende. Manche Träger schließen eine Kündigung vor den Sommerferien aus.'],
  ['Name und Geburtsdatum des Kindes', 'Name der Einrichtung und Vertragsnummer, falls vorhanden', 'Kündigungszeitpunkt', 'Bitte um Bestätigung und Abrechnung der Beiträge', 'Widerruf der Lastschrift für Beiträge und Essensgeld'],
  ['Stehen beide Eltern im Vertrag, sollten auch beide unterschreiben.', 'Beim Wechsel in die Schule endet der Vertrag manchmal automatisch – prüf den Vertrag, bevor du kündigst.', SEND],
  [('Muss ich Essensgeld weiterzahlen?', 'Bis zum Vertragsende meist ja. Frag in der Kündigung nach einer Abrechnung, wenn du im Voraus gezahlt hast.')],
  C('other', thing='den Betreuungsvertrag für meine Tochter Mia Neumann in der Kita Sonnenblume', number='K-2024-031'),
  ['entschuldigung-schule', 'einverstaendnis-klassenfahrt', 'vollmacht-kind-abholen'], 'kita krippe kindergarten betreuung',
  frm=KATRIN, to={'org': 'Kita Sonnenblume', 'attn': 'Träger: Musterverein Kinderbetreuung e. V.', 'street': 'Gartenweg 2', 'city': '79100 Freiburg im Breisgau'})

B('abmeldung-rundfunkbeitrag', 'kuendigung', 'din-letter', 'Abmeldung Rundfunkbeitrag', 'Beitragskonto abmelden, z. B. nach Zusammenzug',
  'Rundfunkbeitrag abmelden: Muster für die Abmeldung des Beitragskontos nach Zusammenzug, Umzug ins Ausland oder Todesfall – mit Beitragsnummern und Nachweisen.',
  ['Der Rundfunkbeitrag wird pro Wohnung gezahlt, nicht pro Person. Ziehst du zu jemandem, der schon zahlt, kannst du dein eigenes Beitragskonto abmelden. Auch beim Umzug ins Ausland oder wenn eine Person verstorben ist, wird abgemeldet.',
   'Am einfachsten geht das mit dem Online-Formular des Beitragsservice. Ein Brief ist eine Alternative, wenn du lieber auf Papier schreibst oder Nachweise beilegen willst.'],
  ['Deine Beitragsnummer', 'Den Grund der Abmeldung und das Datum, ab dem er gilt', 'Bei Zusammenzug: Name und Beitragsnummer der Person, die für die gemeinsame Wohnung weiter zahlt', 'Deine neue Anschrift', 'Bei Todesfall: Kopie der Sterbeurkunde'],
  ['Eine Abmeldung „weil ich keinen Fernseher habe“ ist nicht möglich – der Beitrag hängt an der Wohnung, nicht an Geräten.', 'Eine Befreiung oder Ermäßigung (z. B. bei Bürgergeld oder BAföG) ist etwas anderes als eine Abmeldung und wird gesondert beantragt.', 'Die Postanschrift steht auf jedem Schreiben des Beitragsservice; nutze diese.'],
  [('Bekomme ich zu viel gezahlte Beiträge zurück?', 'Ja, wenn du für eine Zeit doppelt gezahlt hast. Bitte im Brief ausdrücklich um Erstattung auf dein Konto und gib die IBAN an.')],
  {'notice': 'none'}, ['kuendigungsbestaetigung-anfordern', 'kuendigung-mietvertrag', 'widerspruch-bescheid'], 'rundfunk beitragsservice abmelden wohnung',
  frm=LUKAS, to={'org': 'Beitragsservice', 'street': '[Anschrift aus deinem letzten Schreiben]', 'city': ''},
  letter=L('Abmeldung meines Beitragskontos – Beitragsnummer 123 456 789',
           ['zum [Datum] bin ich in die Wohnung von Frau Anna Schmidt, Schillerstraße 40, 04109 Leipzig, gezogen. Für diese Wohnung wird der Rundfunkbeitrag bereits unter der Beitragsnummer 987 654 321 gezahlt.',
            'Ich bitte Sie deshalb, mein Beitragskonto ab diesem Zeitpunkt abzumelden. Falls ich für die Zeit danach Beiträge gezahlt habe, überweisen Sie diese bitte auf mein Konto IBAN DE00 1234 5678 9012 3456 78.',
            'Eine Bestätigung der Abmeldung hätte ich gern schriftlich.'],
           att=['Kopie der Meldebescheinigung']))

B('kuendigungsbestaetigung-anfordern', 'kuendigung', 'din-letter', 'Kündigungsbestätigung anfordern', 'Nachhaken, wenn keine Bestätigung kommt',
  'Keine Antwort auf deine Kündigung? Vorlage, um die Kündigungsbestätigung mit Vertragsende anzufordern – mit Frist, Bezug auf dein Schreiben und Hinweisen zum Nachweis.',
  ['Du hast gekündigt, aber nach zwei, drei Wochen ist noch keine Bestätigung da. Dann lohnt ein freundliches, klares Nachhaken mit Frist. Die Bestätigung ist zwar keine Voraussetzung dafür, dass die Kündigung wirkt – aber sie ist dein bester Nachweis, falls später doch noch abgebucht wird.'],
  ['Bezug auf deine Kündigung mit Datum und Versandart', 'Kunden- oder Vertragsnummer', 'Die Bitte um Bestätigung mit dem genauen Vertragsende', 'Eine Frist, z. B. 14 Tage', 'Hinweis, dass du weitere Abbuchungen zurückbuchen lässt'],
  ['Leg eine Kopie deiner Kündigung bei. Wenn du sie per Einschreiben geschickt hast, auch den Beleg.', 'Wird nach dem Vertragsende weiter abgebucht, kannst du SEPA-Lastschriften in der Regel innerhalb von acht Wochen bei deiner Bank zurückgeben.', 'Bleibt der Anbieter stumm, helfen Verbraucherzentralen weiter.'],
  [('Ist meine Kündigung ohne Bestätigung unwirksam?', 'Nein. Eine Kündigung wirkt, wenn sie beim Empfänger angekommen ist. Die Bestätigung ist ein Beweismittel – deshalb ist der Nachweis des Zugangs so wichtig.')],
  {'notice': 'einschreiben'}, ['kuendigung-handyvertrag', 'kuendigung-fitnessstudio', 'beschwerde'], 'bestätigung kündigung keine antwort nachhaken',
  frm=JANA, to={'org': 'FitMuster Studios GmbH', 'attn': 'Mitgliederverwaltung', 'street': 'Sportallee 5', 'city': '28195 Bremen'},
  letter=L('Bestätigung meiner Kündigung vom [Datum] – Mitgliedsnummer 000815-24',
           ['mit Schreiben vom [Datum], per Einwurf-Einschreiben verschickt, habe ich meine Mitgliedschaft zum nächstmöglichen Zeitpunkt gekündigt. Eine Bestätigung habe ich bis heute nicht erhalten.',
            'Bitte bestätigen Sie mir die Kündigung und das genaue Ende der Mitgliedschaft bis zum [Datum] schriftlich. Eine Kopie meines Kündigungsschreibens und den Einlieferungsbeleg lege ich bei.',
            'Nach dem Vertragsende werde ich weitere Abbuchungen zurückbuchen lassen.'],
           att=['Kopie der Kündigung', 'Einlieferungsbeleg'], notice='einschreiben'))

# ================================================================== Arbeit & Beruf
B('antrag-elternzeit', 'arbeit', 'din-letter', 'Antrag auf Elternzeit', 'Elternzeit beim Arbeitgeber anmelden',
  'Elternzeit beantragen: Muster für die Anmeldung beim Arbeitgeber mit Zeitraum, Verteilung und Teilzeitwunsch – mit Fristen und dem Hinweis zur Form nach Geburtsdatum.',
  ['Du willst nach der Geburt oder Adoption deines Kindes Elternzeit nehmen. Für die Zeit bis zum dritten Geburtstag musst du sie spätestens sieben Wochen vor Beginn verlangen, für eine Zeit zwischen dem dritten und achten Geburtstag spätestens 13 Wochen vorher.',
   'Für Kinder, die ab dem 1. Mai 2025 geboren oder adoptiert wurden, reicht die Textform – also auch eine E-Mail. Für ältere Kinder brauchst du einen unterschriebenen Brief. Mit Unterschrift auf Papier bist du in beiden Fällen auf der sicheren Seite.'],
  ['Name und Geburtsdatum des Kindes (oder errechneter Termin)', 'Den genauen Zeitraum der Elternzeit – bei Beginn direkt nach der Geburt verbindlich für die ersten zwei Jahre', 'Ob du Elternzeit in Abschnitten nimmst', 'Falls gewünscht: Teilzeit während der Elternzeit mit Stunden und Verteilung', 'Bitte um Bestätigung'],
  ['Ab dem Antrag, frühestens acht Wochen vor Beginn der Elternzeit, gilt ein besonderer Kündigungsschutz.', 'Elterngeld beantragst du nicht beim Arbeitgeber, sondern bei der Elterngeldstelle.', 'Der Arbeitgeber soll dir die Elternzeit bescheinigen – bitte ausdrücklich darum.'],
  [('Muss ich die ganze Elternzeit sofort festlegen?', 'Du legst dich verbindlich für die ersten zwei Jahre ab dem Beginn fest. Die übrige Zeit bis zum achten Geburtstag kannst du später anmelden.'),
   ('Kann ich während der Elternzeit Teilzeit arbeiten?', 'Ja, bis zu 32 Wochenstunden im Durchschnitt des Monats. Unter bestimmten Voraussetzungen hast du einen Anspruch darauf; den Wunsch kannst du gleich in diesem Schreiben nennen.')],
  {'notice': 'none'}, ['antrag-teilzeit', 'krankmeldung-email', 'urlaubsantrag-erholungsurlaub'], 'elternzeit baby geburt arbeitgeber',
  frm=KATRIN, to={'org': 'Muster Software GmbH', 'attn': 'Personalabteilung', 'street': 'Kaiser-Joseph-Straße 200', 'city': '79098 Freiburg im Breisgau'},
  letter=L('Antrag auf Elternzeit',
           ['unser Kind ist am [Datum] zur Welt gekommen. Ich nehme Elternzeit vom [Datum] bis zum [Datum] und lege mich für diesen Zeitraum verbindlich fest.',
            'Während der Elternzeit möchte ich ab dem [Datum] in Teilzeit mit 20 Stunden pro Woche arbeiten, verteilt auf Montag bis Donnerstag jeweils vormittags. Über die Einzelheiten spreche ich gern mit Frau Kaiser aus meinem Team.',
            'Bitte bestätigen Sie mir die Elternzeit schriftlich. Die Geburtsurkunde reiche ich nach, sobald sie vorliegt.'],
           att=['Kopie der Geburtsurkunde (folgt)']))

B('antrag-teilzeit', 'arbeit', 'din-letter', 'Antrag auf Teilzeit', 'Arbeitszeit dauerhaft oder befristet verringern',
  'Teilzeit beantragen beim Arbeitgeber: Muster mit gewünschter Stundenzahl, Verteilung und Beginn – mit den Voraussetzungen und der Drei-Monats-Frist erklärt.',
  ['Du willst weniger arbeiten – wegen Kindern, Pflege, Weiterbildung oder einfach mehr Zeit. Ein gesetzlicher Anspruch auf Teilzeit besteht, wenn du länger als sechs Monate im Betrieb bist und dein Arbeitgeber in der Regel mehr als 15 Beschäftigte hat. Den Wunsch musst du spätestens drei Monate vor dem gewünschten Beginn in Textform äußern.',
   'Für eine befristete Teilzeit von ein bis fünf Jahren mit Rückkehrrecht (Brückenteilzeit) gelten strengere Voraussetzungen, unter anderem mehr als 45 Beschäftigte.'],
  ['Die gewünschte Wochenarbeitszeit', 'Den gewünschten Beginn – mindestens drei Monate nach dem Antrag', 'Wie die Stunden verteilt werden sollen', 'Ob dauerhaft oder befristet (Brückenteilzeit) mit Enddatum', 'Bitte um ein Gespräch und eine schriftliche Antwort'],
  ['Der Arbeitgeber muss den Wunsch mit dir erörtern und kann ihn nur aus betrieblichen Gründen ablehnen.', 'Lehnt er nicht spätestens einen Monat vor dem gewünschten Beginn in Textform ab, gilt deine Teilzeit nach dem Gesetz als vereinbart.', 'In Tarifverträgen oder Betriebsvereinbarungen können günstigere Regeln stehen.'],
  [('Was ist der Unterschied zur Teilzeit in Elternzeit?', 'Teilzeit während der Elternzeit ist ein eigener Anspruch nach dem Elterngeld- und Elternzeitgesetz. Für Eltern in Elternzeit ist das passende Muster der Antrag auf Elternzeit.')],
  {'notice': 'none'}, ['antrag-elternzeit', 'urlaubsantrag-erholungsurlaub', 'kuendigung-arbeitsvertrag'], 'teilzeit stunden reduzieren arbeitszeit brückenteilzeit',
  frm=THOMAS, to={'org': 'Muster Handel GmbH & Co. KG', 'attn': 'Personalabteilung', 'street': 'Wilhelmshöher Allee 77', 'city': '34119 Kassel'},
  letter=L('Antrag auf Verringerung meiner Arbeitszeit',
           ['nach § 8 des Teilzeit- und Befristungsgesetzes beantrage ich, meine Arbeitszeit ab dem [Datum] von 40 auf 30 Stunden pro Woche zu verringern.',
            'Die Stunden würde ich gern auf Montag bis Freitag von 8 bis 14 Uhr verteilen. So kann ich meine Mutter nachmittags bei Arztterminen begleiten. Meine Aufgaben in der Disposition lassen sich nach meiner Einschätzung gut in dieser Zeit erledigen; für Übergaben am Nachmittag habe ich eine Lösung mit Herrn Yilmaz besprochen.',
            'Über ein Gespräch dazu freue ich mich. Bitte antworten Sie mir schriftlich.']))

B('krankmeldung-email', 'arbeit', 'din-letter', 'Krankmeldung per E-Mail', 'Arbeitgeber über Arbeitsunfähigkeit informieren',
  'Krankmeldung an den Arbeitgeber als Muster-E-Mail: kurz, ohne Diagnose, mit voraussichtlicher Dauer – plus Infos zur elektronischen AU und zur Frist.',
  ['Du bist krank und kannst nicht arbeiten. Dann musst du deinem Arbeitgeber die Arbeitsunfähigkeit und ihre voraussichtliche Dauer sofort mitteilen – in der Regel vor Arbeitsbeginn am ersten Tag. Wie (Anruf, E-Mail, Nachricht), regelt oft der Arbeitsvertrag.',
   'Dauert die Krankheit länger als drei Kalendertage, brauchst du spätestens am vierten Tag eine ärztliche Bescheinigung; dein Arbeitgeber kann sie auch früher verlangen.'],
  ['Dass du arbeitsunfähig bist – ohne Diagnose', 'Ab wann und voraussichtlich bis wann', 'Ob du beim Arzt warst und die Bescheinigung elektronisch abgerufen werden kann', 'Wichtige Termine oder Übergaben, die jemand übernehmen muss'],
  ['Gesetzlich Versicherte bekommen seit 2023 eine elektronische Arbeitsunfähigkeitsbescheinigung: Die Praxis meldet sie an die Krankenkasse, der Arbeitgeber ruft sie dort ab. Du musst keinen gelben Schein mehr abgeben – krankmelden musst du dich trotzdem selbst.', 'Privat Versicherte bekommen weiterhin eine Bescheinigung auf Papier und reichen sie selbst ein.', 'Die Diagnose geht deinen Arbeitgeber nichts an.'],
  [('Reicht eine WhatsApp-Nachricht?', 'Wenn dein Arbeitgeber das so akzeptiert, ja. Wichtig ist, dass die Nachricht rechtzeitig ankommt und die richtige Person erreicht. Ein Anruf plus kurze E-Mail ist oft am sichersten.')],
  {'notice': 'none'}, ['kuendigung-arbeitsvertrag', 'urlaubsantrag-erholungsurlaub', 'entschuldigung-schule'], 'krank krankmeldung au arbeitsunfähig',
  frm=SEVGI, to={'org': 'Muster Logistik GmbH', 'attn': 'Herr Brandt, Teamleitung Lager', 'street': 'Industriestraße 10', 'city': '28197 Bremen'},
  letter=L('Krankmeldung – Sevgi Arslan', ['ich bin heute krank und kann nicht zur Arbeit kommen. Laut meiner Hausärztin werde ich voraussichtlich bis einschließlich [Datum] arbeitsunfähig sein; die Bescheinigung ist elektronisch an meine Krankenkasse gemeldet.',
            'Die Inventur am Mittwoch kann Herr Lange übernehmen, die Liste liegt im Ordner „Inventur“ auf dem Laufwerk. Sollte sich etwas ändern, melde ich mich sofort.'],
           salutation='Guten Morgen Herr Brandt,', closing='Viele Grüße'), mail=True)

B('urlaubsantrag-erholungsurlaub', 'arbeit', 'leave-request', 'Urlaubsantrag (Erholungsurlaub)', 'Urlaub beantragen mit Arbeitstage-Rechner',
  'Urlaubsantrag als Vorlage: Zeitraum eintragen, Arbeitstage ohne Wochenenden und Feiertage zählen lassen, Resturlaub sehen – mit Feld für die Genehmigung. Als PDF.',
  ['Du willst Urlaub nehmen und dein Arbeitgeber möchte einen schriftlichen Antrag. Die Vorlage zählt die Arbeitstage zwischen Von und Bis – ohne Wochenenden und ohne die Feiertage deines Bundeslandes – und zeigt, wie viel Urlaub danach übrig bleibt.'],
  ['Name, Personalnummer und Abteilung', 'Zeitraum mit erstem und letztem Urlaubstag', 'Anzahl der Arbeitstage', 'Urlaubsanspruch und bereits genommene Tage', 'Vertretung während des Urlaubs', 'Feld für Genehmigung und Unterschrift der Vorgesetzten'],
  ['Urlaub ist erst genommen, wenn er genehmigt ist. Fahr nicht einfach los – selbst wenn der Antrag schon länger liegt.', 'Der gesetzliche Mindesturlaub beträgt bei einer Fünftagewoche 20 Arbeitstage; in Arbeits- und Tarifverträgen steht oft mehr.', 'Resturlaub verfällt nicht automatisch: Der Arbeitgeber muss dich rechtzeitig auf drohenden Verfall hinweisen.'],
  [('Werden Feiertage mitgezählt?', 'Nein. Die Vorlage zieht die gesetzlichen Feiertage deines Bundeslandes ab – Bundesland im Formular auswählen.')],
  {'kind': 'rest', 'name': 'Jana Beispiel', 'staffNo': '20451', 'dept': 'Kundenservice', 'boss': 'Frau Hoffmann', 'stand': 'Tim Lange', 'note': '', 'state': 'SL'},
  ['antrag-sonderurlaub', 'antrag-bildungsurlaub', 'antrag-teilzeit'], 'urlaub antrag arbeitgeber resturlaub',
  doc=[['Art', 'Erholungsurlaub'], ['Antragstellerin', 'Jana Beispiel, Personalnummer 20451, Kundenservice'], ['Vorgesetzte', 'Frau Hoffmann'], ['Zeitraum', 'Von – bis (trägst du im Formular ein), mit Arbeitstagen'],
       ['Text', 'Ich beantrage Urlaub für folgenden Zeitraum: … Berechnet für: 5-Tage-Woche, Feiertage Saarland.'], ['Urlaubskonto', 'Anspruch, bereits genommen, dieser Antrag, Resturlaub danach'], ['Vertretung', 'Tim Lange'],
       ['Unterschriften', 'Mitarbeiterin, Vertretung, Feld „genehmigt / abgelehnt“ für den Arbeitgeber']],
  doc_intro='Der Urlaubsantrag ist ein Formular, kein Brief. So ist er aufgebaut:')

B('antrag-sonderurlaub', 'arbeit', 'leave-request', 'Antrag auf Sonderurlaub', 'Freistellung für Hochzeit, Umzug oder Todesfall',
  'Sonderurlaub beantragen: Vorlage für Hochzeit, Geburt, Umzug oder Trauerfall mit Anlass und Zeitraum – mit ehrlichem Hinweis, wann es einen Anspruch gibt.',
  ['Bei bestimmten Anlässen gibt es bezahlte Freistellung, ohne dass ein Urlaubstag verbraucht wird – etwa bei der eigenen Hochzeit, der Geburt eines Kindes oder einem Todesfall in der Familie. Ob und wie viele Tage, regeln vor allem Tarifvertrag, Arbeitsvertrag oder Betriebsvereinbarung.',
   'Steht dort nichts, kann ein Anspruch aus dem Gesetz für eine kurze, unvermeidbare Verhinderung bestehen – dieser kann aber im Vertrag ausgeschlossen sein.'],
  ['Anlass und Datum', 'Zeitraum der Freistellung', 'Bezug auf die Regel im Tarif- oder Arbeitsvertrag, falls vorhanden', 'Nachweis, den du beilegst oder nachreichst', 'Unterschrift'],
  ['Frag im Zweifel in der Personalabteilung oder beim Betriebsrat nach, welche Anlässe bei euch gelten.', 'Für einen Umzug gibt es bei vielen Arbeitgebern einen Tag – aber nicht überall.', 'Wenn kein Anspruch besteht, kannst du die Tage als Erholungsurlaub oder unbezahlten Urlaub beantragen.'],
  [('Muss ich einen Nachweis bringen?', 'Oft ja, etwa die Heiratsurkunde oder die Sterbeurkunde. Leg ihn bei oder reich ihn nach.')],
  {'kind': 'special', 'name': 'Markus Probe', 'staffNo': '7741', 'dept': 'Produktion', 'boss': 'Herr Klein', 'stand': '', 'note': 'Anlass: eigene Eheschließung am [Datum]. Freistellung nach § 12 des Manteltarifvertrags (bitte prüfen). Die Heiratsurkunde reiche ich nach.', 'state': 'RP'},
  ['urlaubsantrag-erholungsurlaub', 'antrag-bildungsurlaub', 'antrag-elternzeit'], 'sonderurlaub hochzeit umzug todesfall freistellung',
  doc=[['Art', 'Sonderurlaub'], ['Antragsteller', 'Markus Probe, Personalnummer 7741, Produktion'], ['Zeitraum', 'Von – bis, mit Arbeitstagen'],
       ['Bemerkung', 'Anlass: eigene Eheschließung am [Datum]. Freistellung nach § 12 des Manteltarifvertrags (bitte prüfen). Die Heiratsurkunde reiche ich nach.'], ['Unterschriften', 'Mitarbeiter, Feld für die Genehmigung']],
  doc_intro='Sonderurlaub wird mit demselben Formular beantragt wie Erholungsurlaub – nur die Art und die Bemerkung unterscheiden sich:')

B('antrag-bildungsurlaub', 'arbeit', 'leave-request', 'Antrag auf Bildungsurlaub', 'Bezahlte Freistellung für eine Weiterbildung',
  'Bildungsurlaub beantragen: Vorlage mit Seminar, Veranstalter und Anerkennung – mit Hinweisen zu Fristen und Ländergesetzen. Arbeitstage werden automatisch gezählt.',
  ['In fast allen Bundesländern hast du Anspruch auf einige Tage bezahlten Bildungsurlaub pro Jahr, meist fünf Tage. Die Veranstaltung muss im jeweiligen Bundesland anerkannt sein. In Bayern und Sachsen gibt es kein Bildungsurlaubsgesetz.',
   'Den Antrag musst du rechtzeitig stellen – je nach Land meist sechs bis acht Wochen vor Beginn.'],
  ['Titel, Termin und Ort der Veranstaltung', 'Veranstalter und Nachweis der Anerkennung', 'Zeitraum und Arbeitstage', 'Bezug auf das Bildungsurlaubsgesetz deines Landes', 'Programm als Anlage'],
  ['Die Anerkennung steht meist auf der Website des Veranstalters oder in der Kursbeschreibung.', 'Der Arbeitgeber kann den Bildungsurlaub nur aus wichtigen betrieblichen Gründen verschieben; das muss er rechtzeitig sagen.', 'Nach dem Kurs brauchst du meist eine Teilnahmebestätigung für den Arbeitgeber.'],
  [('Muss das Seminar mit meinem Beruf zu tun haben?', 'Nicht unbedingt. Viele Ländergesetze erlauben auch politische Bildung oder Sprachkurse. Was genau zählt, regelt das Gesetz deines Bundeslandes.')],
  {'kind': 'edu', 'name': 'Thomas Muster', 'staffNo': 'L-118', 'dept': 'Vertrieb', 'boss': 'Frau Richter', 'stand': '', 'note': 'Seminar „Präsentieren und Moderieren“, Veranstalter: Bildungswerk Muster e. V., anerkannt nach dem Bildungsurlaubsgesetz des Landes. Programm und Anerkennung liegen bei.', 'state': 'HE'},
  ['urlaubsantrag-erholungsurlaub', 'antrag-sonderurlaub', 'antrag-teilzeit'], 'bildungsurlaub weiterbildung seminar freistellung',
  doc=[['Art', 'Bildungsurlaub'], ['Antragsteller', 'Thomas Muster, Personalnummer L-118, Vertrieb'], ['Zeitraum', 'Von – bis, mit Arbeitstagen'],
       ['Bemerkung', 'Seminar „Präsentieren und Moderieren“, Veranstalter: Bildungswerk Muster e. V., anerkannt nach dem Bildungsurlaubsgesetz des Landes. Programm und Anerkennung liegen bei.'], ['Unterschriften', 'Mitarbeiter, Feld für die Genehmigung']],
  doc_intro='Der Antrag nutzt das Urlaubsformular mit der Art „Bildungsurlaub“. Wähl im Formular dein Bundesland – Bildungsurlaub gibt es nicht in jedem Land:')

# ================================================================== Wohnen
B('maengelanzeige-wohnung', 'wohnen', 'din-letter', 'Mängelanzeige an den Vermieter', 'Schimmel, Heizung, Wasserschaden melden mit Frist',
  'Mängelanzeige für die Mietwohnung: Muster, um Schimmel, Heizungsausfall oder Feuchtigkeit zu melden und eine Frist zu setzen – mit Hinweisen zur Mietminderung.',
  ['In deiner Wohnung ist etwas kaputt oder beschädigt: Die Heizung fällt aus, an der Wand bildet sich Schimmel, das Fenster schließt nicht mehr. Als Mieter musst du solche Mängel dem Vermieter unverzüglich melden – sonst kannst du für Folgeschäden haften.',
   'Eine schriftliche Mängelanzeige mit Frist ist der erste Schritt, wenn ein kurzer Anruf nichts gebracht hat oder es um etwas Ernstes geht.'],
  ['Genaue Beschreibung des Mangels: was, wo, seit wann', 'Fotos mit Datum als Anlage', 'Bitte um Beseitigung und eine angemessene Frist', 'Erreichbarkeit für Handwerkertermine', 'Vorbehalt der Mietminderung'],
  ['Die Miete mindert sich bei einem erheblichen Mangel kraft Gesetzes. Wie viel angemessen ist, ist oft strittig – mindere nicht auf eigene Faust zu stark, sondern zahl im Zweifel „unter Vorbehalt“ und lass dich beraten, etwa beim Mieterverein.', 'Bei Gefahr (Wasserrohrbruch, Gasgeruch, kein Strom) ruf sofort an oder den Notdienst – der Brief kommt danach.', 'Heb Kopien aller Schreiben und Fotos auf.'],
  [('Was ist eine angemessene Frist?', 'Das hängt vom Mangel ab. Bei Heizungsausfall im Winter sind es wenige Tage, bei einem klemmenden Fenster eher zwei Wochen.'),
   ('Darf ich selbst einen Handwerker beauftragen?', 'Nur in Ausnahmefällen, etwa wenn der Vermieter trotz Frist nichts tut oder ein Notfall vorliegt. Sonst bleibst du auf den Kosten sitzen – lass dich vorher beraten.')],
  {'notice': 'none'}, ['kuendigung-mietvertrag', 'beschwerde', 'vollmacht-wohnungsuebergabe'], 'schimmel heizung mangel miete vermieter mietminderung',
  frm=SEVGI, to={'org': 'Hausverwaltung Muster & Partner', 'attn': 'Herr Berger', 'street': 'Am Wall 101', 'city': '28195 Bremen'},
  letter=L('Mängelanzeige: Feuchtigkeit und Schimmel im Schlafzimmer, Hafenstraße 21, 1. OG rechts',
           ['seit Anfang des Monats bildet sich im Schlafzimmer meiner Wohnung an der Außenwand hinter dem Kleiderschrank Schimmel. Die betroffene Fläche ist inzwischen etwa einen halben Quadratmeter groß, die Tapete fühlt sich feucht an. Ich lüfte mehrmals täglich stoßweise und heize den Raum auf etwa 18 Grad.',
            'Bitte lassen Sie die Ursache untersuchen und den Mangel bis zum [Datum] beseitigen. Für einen Termin mit dem Handwerksbetrieb bin ich werktags ab 15 Uhr erreichbar, Telefon 0421 123456.',
            'Bis zur Beseitigung des Mangels behalte ich mir eine Minderung der Miete vor. Fotos vom [Datum] lege ich bei.'],
           att=['Fotos des Schadens (3 Stück)']))

B('vollmacht-wohnungsuebergabe', 'vollmacht', 'power-of-attorney', 'Vollmacht für die Wohnungsübergabe', 'Jemand anderen zur Übergabe schicken',
  'Vollmacht für die Wohnungsübergabe: Muster, damit eine Vertrauensperson Protokoll, Zählerstände und Schlüssel für dich erledigt – ausfüllen und als PDF drucken.',
  ['Du kannst beim Übergabetermin nicht selbst dabei sein – etwa weil du schon in eine andere Stadt gezogen bist. Mit dieser Vollmacht darf eine Person deines Vertrauens das Übergabeprotokoll unterschreiben, Zählerstände festhalten und Schlüssel übergeben oder entgegennehmen.'],
  ['Deine Daten als Mieterin oder Mieter (Vollmachtgeber)', 'Name und Anschrift der bevollmächtigten Person', 'Anschrift der Wohnung und Datum der Übergabe', 'Was die Person darf: Protokoll unterschreiben, Zählerstände, Schlüssel', 'Gültigkeit – hier am besten nur für den Übergabetag', 'Deine Unterschrift'],
  ['Die bevollmächtigte Person nimmt am besten ihren Ausweis und eine Kopie deines Ausweises mit.', 'Sprich vorher mit ihr durch, worauf sie achten soll: Mängel, die schon beim Einzug da waren, gehören ins Protokoll.', 'Mit der Unterschrift unter dem Protokoll werden Zustand und Zählerstände festgehalten – das kann später nur schwer korrigiert werden.'],
  [('Muss die Vollmacht notariell beglaubigt sein?', 'Nein, für die Wohnungsübergabe reicht eine einfache schriftliche Vollmacht mit deiner Unterschrift.')],
  {'purpose': 'flat', 'gName': 'Jana Beispiel', 'gStreet': 'Neue Gasse 4', 'gCity': '10115 Berlin', 'aName': 'Paul Beispiel', 'aStreet': 'Lindenstraße 30', 'aCity': '66111 Saarbrücken', 'flatAddr': 'Lindenstraße 12, 2. OG links, 66111 Saarbrücken', 'valid': 'day'},
  ['kuendigung-mietvertrag', 'vollmacht-post', 'maengelanzeige-wohnung'], 'übergabe wohnung vollmacht auszug',
  doc=[['Titel', 'Vollmacht für die Wohnungsübergabe'], ['Vollmachtgeberin', 'Jana Beispiel, Neue Gasse 4, 10115 Berlin'], ['Bevollmächtigter', 'Paul Beispiel, Lindenstraße 30, 66111 Saarbrücken'],
       ['Text', 'Hiermit bevollmächtige ich … mich bei der Übergabe der Wohnung Lindenstraße 12, 2. OG links, 66111 Saarbrücken am [Datum] zu vertreten, insbesondere das Übergabeprotokoll zu unterzeichnen, Zählerstände festzuhalten und Schlüssel zu übergeben bzw. entgegenzunehmen.'],
       ['Gültigkeit', 'Nur am Übergabetag'], ['Unterschriften', 'Vollmachtgeberin; Unterschriftsprobe des Bevollmächtigten']])

# ================================================================== Widerspruch & Beschwerde
B('widerspruch-bescheid', 'behoerde', 'din-letter', 'Widerspruch gegen einen Bescheid', 'Fristwahrend Widerspruch einlegen – Begründung folgt',
  'Widerspruch gegen einen Bescheid einlegen: allgemeines Muster mit Aktenzeichen, Frist und nachgereichter Begründung – mit klaren Hinweisen, keine Rechtsberatung.',
  ['Du hast einen Bescheid bekommen, mit dem du nicht einverstanden bist – etwa von einer Behörde, der Familienkasse oder der Krankenkasse. Unten im Bescheid steht in der Rechtsbehelfsbelehrung, ob und bis wann du Widerspruch einlegen kannst. Meist ist es ein Monat ab Bekanntgabe.',
   'Wenn die Zeit knapp ist, legst du zuerst nur fristwahrend Widerspruch ein und reichst die Begründung nach. Genau das macht dieses Muster.'],
  ['Behörde und Aktenzeichen aus dem Bescheid', 'Datum des Bescheids und worum es geht', 'Den klaren Satz „Hiermit lege ich Widerspruch ein“', 'Begründung – oder den Hinweis, dass sie folgt', 'Bitte um Akteneinsicht, falls du Unterlagen brauchst', 'Deine Unterschrift'],
  ['Achte auf die Frist: Sie beginnt mit der Bekanntgabe. Bei einfacher Post gilt der Bescheid in der Regel am vierten Tag nach Absendung als bekannt gegeben.', 'Ein Widerspruch per einfacher E-Mail ist oft nicht wirksam. Schick ihn per Post, gib ihn persönlich ab oder nutze den elektronischen Weg, den die Rechtsbehelfsbelehrung nennt.', 'Ein Widerspruch hat nicht immer aufschiebende Wirkung – eine geforderte Zahlung kann trotzdem fällig sein.', 'Hilfe bekommst du je nach Thema bei Sozialverbänden, Verbraucherzentralen, Lohnsteuerhilfevereinen, Mietervereinen oder einer Anwältin bzw. einem Anwalt.'],
  [('Kostet ein Widerspruch Geld?', 'Bei Sozialleistungen ist das Widerspruchsverfahren in der Regel kostenfrei. In anderen Bereichen können Gebühren anfallen, wenn der Widerspruch erfolglos bleibt – steht oft in der Rechtsbehelfsbelehrung oder lässt sich bei der Behörde erfragen.'),
   ('Was passiert nach dem Widerspruch?', 'Die Behörde prüft den Fall noch einmal. Sie hilft dem Widerspruch ab oder erlässt einen Widerspruchsbescheid. Gegen diesen kannst du dann meist klagen – auch dafür gilt eine Frist.')],
  {'notice': 'none'}, ['beschwerde', 'dsgvo-auskunft', 'abmeldung-rundfunkbeitrag'], 'widerspruch bescheid behörde amt frist einspruch',
  frm=THOMAS, to={'org': 'Stadt Musterstadt', 'attn': 'Amt für Soziales, Sachgebiet 50.2', 'street': 'Rathausplatz 1', 'city': '34117 Kassel'},
  letter=L('Widerspruch gegen Ihren Bescheid vom [Datum], Aktenzeichen [Aktenzeichen]',
           ['gegen Ihren oben genannten Bescheid, mir zugegangen am [Datum], lege ich Widerspruch ein.',
            'Die Begründung reiche ich nach, sobald mir alle Unterlagen vorliegen. Bitte gewähren Sie mir dazu Einsicht in die Verwaltungsakte oder senden Sie mir Kopien der Unterlagen, auf die sich der Bescheid stützt.',
            'Bitte bestätigen Sie mir den Eingang dieses Widerspruchs.']))

B('beschwerde', 'behoerde', 'din-letter', 'Beschwerde an ein Unternehmen', 'Sachlich beschweren und eine Lösung verlangen',
  'Beschwerdebrief an ein Unternehmen als Muster: Problem sachlich schildern, Nachweise beilegen, konkrete Lösung und Frist verlangen – mit Tipps für den nächsten Schritt.',
  ['Eine Lieferung kommt immer wieder zu spät, ein Handwerker hat schlecht gearbeitet oder du wartest seit Wochen auf eine Erstattung. Wenn Anrufe und Chat nichts bringen, hilft eine schriftliche Beschwerde: Sie ist dokumentiert, landet oft bei einer anderen Stelle und setzt eine Frist.'],
  ['Kunden-, Auftrags- oder Rechnungsnummer', 'Was passiert ist – mit Daten, kurz und sachlich', 'Was du bisher unternommen hast', 'Was du konkret willst: Nachbesserung, Erstattung, Gutschrift', 'Eine Frist', 'Nachweise als Anlage'],
  ['Bleib sachlich, auch wenn du dich ärgerst – ein ruhiger Brief wird eher an die richtige Stelle weitergegeben.', 'Hilft auch die Beschwerde nicht, kannst du dich an eine Verbraucherschlichtungsstelle wenden; viele Unternehmen nennen auf ihrer Website, an welcher sie teilnehmen.', 'Bei Mängeln an gekaufter Ware hast du gesetzliche Gewährleistungsrechte – unabhängig von einer Garantie.'],
  [('Wie lang sollte eine Beschwerde sein?', 'So kurz wie möglich, so lang wie nötig. Eine Seite reicht fast immer. Daten und Nummern sind wichtiger als ausführliche Schilderungen.')],
  {'notice': 'none'}, ['kuendigungsbestaetigung-anfordern', 'widerruf-onlinekauf', 'maengelanzeige-wohnung'], 'beschwerde reklamation kundenservice ärger',
  frm=MARKUS, to={'org': 'Musterversand GmbH', 'attn': 'Beschwerdemanagement', 'street': 'Logistikring 7', 'city': '54294 Trier'},
  letter=L('Beschwerde zu Auftrag 2026-447812: Erstattung seit sechs Wochen offen',
           ['am [Datum] habe ich die Bestellung 2026-447812 vollständig an Sie zurückgeschickt; laut Sendungsverfolgung ist das Paket zwei Tage später bei Ihnen angekommen. Die Erstattung über 189,90 Euro ist bis heute nicht auf meinem Konto eingegangen.',
            'Ihr Kundenservice hat mir am Telefon zweimal zugesagt, die Erstattung „in den nächsten Tagen“ anzuweisen, zuletzt am [Datum]. Passiert ist seitdem nichts.',
            'Bitte erstatten Sie den Betrag bis zum [Datum] über die Zahlungsart, mit der ich bestellt habe. Den Einlieferungsbeleg und die Sendungsverfolgung lege ich bei.'],
           att=['Einlieferungsbeleg', 'Ausdruck der Sendungsverfolgung']))

# ================================================================== Datenschutz
EN_GDPR_FROM = ['Jana Beispiel', '12 Linden Street', 'Bristol BS1 4AA']
B('dsgvo-auskunft', 'datenschutz', 'din-letter', 'Auskunft über gespeicherte Daten (Art. 15 DSGVO)', 'Erfahren, welche Daten ein Unternehmen über dich hat',
  'DSGVO-Auskunft nach Art. 15 anfordern: Muster für die Selbstauskunft bei Unternehmen oder Behörden – mit allen Punkten, die dir zustehen, und der Frist von einem Monat.',
  ['Du willst wissen, welche Daten eine Firma, ein Verein oder eine Behörde über dich speichert – etwa nach Werbung, die du nie bestellt hast, oder vor einer Kündigung. Nach Art. 15 der Datenschutz-Grundverordnung hast du einen Anspruch auf Auskunft und eine Kopie deiner Daten. Gründe musst du nicht nennen.',
   'Die Stelle muss in der Regel innerhalb eines Monats antworten; in schwierigen Fällen kann sich die Frist um bis zu zwei Monate verlängern, das muss sie dir aber mitteilen.'],
  ['Deine Angaben, mit denen man dich findet: Name, Anschrift, Kundennummer, E-Mail', 'Die Bitte um Bestätigung, ob Daten verarbeitet werden', 'Die Punkte aus Art. 15: Zwecke, Kategorien, Empfänger, Speicherdauer, Herkunft, automatisierte Entscheidungen', 'Die Bitte um eine Kopie der Daten', 'Frist: ein Monat'],
  ['Die Auskunft ist kostenlos. Für weitere Kopien darf ein angemessenes Entgelt verlangt werden.', 'Schick die Anfrage an den Datenschutzbeauftragten oder die Adresse, die in der Datenschutzerklärung genannt ist. Eine E-Mail ist zulässig.', 'Kommt keine oder eine unvollständige Antwort, kannst du dich bei der Datenschutzaufsichtsbehörde beschweren.'],
  [('Darf die Firma meinen Ausweis verlangen?', 'Nur wenn sie begründete Zweifel an deiner Identität hat. Dann kann sie zusätzliche Angaben verlangen. Eine Ausweiskopie solltest du nur geschwärzt schicken (alles außer Name, Anschrift und Gültigkeit).')],
  {'notice': 'none'}, ['dsgvo-loeschung', 'widerspruch-bescheid', 'kuendigung-streaming'], 'dsgvo auskunft daten selbstauskunft datenschutz art 15',
  frm=JANA, to={'org': 'Muster Shopping GmbH', 'attn': 'Datenschutzbeauftragte', 'street': 'Handelsweg 3', 'city': '20095 Hamburg'},
  letter=L('Auskunft nach Art. 15 DSGVO – Kundennummer 5544-21',
           ['bitte teilen Sie mir mit, ob Sie personenbezogene Daten über mich verarbeiten. Falls ja, bitte ich um Auskunft nach Art. 15 DSGVO über diese Daten, die Zwecke der Verarbeitung, die Empfänger, die geplante Speicherdauer, die Herkunft der Daten und darüber, ob eine automatisierte Entscheidungsfindung einschließlich Profiling stattfindet.',
            'Außerdem bitte ich um eine Kopie der Daten nach Art. 15 Abs. 3 DSGVO, gern als PDF per E-Mail an jana.beispiel@example.com.',
            'Ich erwarte Ihre Antwort innerhalb eines Monats nach Eingang dieses Schreibens. Zu meiner Identifizierung: Bei Ihnen bin ich unter der Kundennummer 5544-21 und der E-Mail-Adresse jana.beispiel@example.com registriert.']),
  en={'name': 'Subject access request (GDPR Art. 15)', 'slug': 'gdpr-subject-access-request', 'short': 'Find out what personal data a company holds about you',
      'desc': 'Free GDPR subject access request template (Art. 15): ask a company what personal data it holds about you and get a copy – with the one-month deadline explained.',
      'h1': 'Subject access request under the GDPR (Art. 15)',
      'when': ['You want to know what data a company, club or public body holds about you – for example after marketing you never asked for. Under Article 15 GDPR you have a right to access and to a copy of your data. You do not need to give a reason.',
               'The organisation must usually reply within one month. In complex cases this can be extended by up to two further months, but they have to tell you.'],
      'must': ['Details that identify you: name, address, customer number, e-mail', 'A request to confirm whether your data is processed', 'The points of Art. 15: purposes, categories, recipients, retention period, source, automated decisions', 'A request for a copy of the data', 'Deadline: one month'],
      'notes': ['Access is free of charge. A reasonable fee may be charged for further copies.', 'Send the request to the data protection officer or the address given in the privacy notice; e-mail is fine.', 'If you get no or an incomplete answer, you can complain to the data protection supervisory authority.', 'In the UK the UK GDPR applies with the same right of access.'],
      'faq': [{'q': 'Can the company ask for my ID?', 'a': 'Only if it has reasonable doubts about your identity. Then it may ask for further information. If you send a copy of an ID document, black out everything except your name, address and validity.'}],
      'from': EN_GDPR_FROM, 'to': {'org': 'Example Shopping Ltd', 'attn': 'Data Protection Officer', 'street': '3 Market Way', 'city': 'London EC1A 1AA'},
      'letter': L('Subject access request under Article 15 GDPR – customer number 5544-21',
                  ['Please confirm whether you process personal data about me. If you do, I request access under Article 15 GDPR to that data, the purposes of the processing, the recipients, the intended retention period, the source of the data and whether any automated decision-making, including profiling, takes place.',
                   'I also request a copy of the data under Article 15(3) GDPR, preferably as a PDF by e-mail to jana.beispiel@example.com.',
                   'I expect your reply within one month of receiving this letter. To identify me: I am registered with you under customer number 5544-21 and the e-mail address jana.beispiel@example.com.'],
                  salutation='Dear Sir or Madam,', closing='Yours faithfully,'),
      'fields': {'notice': 'none'}})

B('dsgvo-loeschung', 'datenschutz', 'din-letter', 'Löschung von Daten verlangen (Art. 17 DSGVO)', 'Ein Unternehmen auffordern, deine Daten zu löschen',
  'Daten löschen lassen nach Art. 17 DSGVO: Muster für die Löschungsaufforderung mit Bestätigung und Weitergabe an Empfänger – inklusive Ausnahmen und Frist erklärt.',
  ['Du hast ein Konto gekündigt, bekommst ungewollt Werbung oder willst einfach nicht mehr in einer Kundendatei stehen. Nach Art. 17 DSGVO kannst du verlangen, dass deine Daten gelöscht werden – etwa wenn sie für den Zweck nicht mehr nötig sind oder du deine Einwilligung widerrufst.',
   'Daten, die das Unternehmen aufbewahren muss – zum Beispiel Rechnungen für das Finanzamt –, darf es behalten, aber nur noch dafür nutzen.'],
  ['Angaben, mit denen man dich findet', 'Die Aufforderung zur Löschung nach Art. 17 DSGVO', 'Widerruf erteilter Einwilligungen und Widerspruch gegen Werbung', 'Bitte, auch Empfänger zu informieren (Art. 19)', 'Bitte um Bestätigung – Frist ein Monat'],
  ['Wenn du nur keine Werbung mehr willst, reicht ein Widerspruch gegen die Nutzung für Werbung (Art. 21 Abs. 2) – den enthält das Muster gleich mit.', 'Behält das Unternehmen Daten wegen Aufbewahrungspflichten, muss es sie sperren und dir sagen, warum.', 'Antwortet niemand, hilft eine Beschwerde bei der Datenschutzaufsichtsbehörde.'],
  [('Muss ich begründen, warum ich die Löschung will?', 'Nein, eine ausführliche Begründung ist nicht nötig. Es hilft aber, den Grund kurz zu nennen, etwa „Vertrag beendet“ oder „Einwilligung widerrufen“.')],
  {'notice': 'none'}, ['dsgvo-auskunft', 'kuendigung-streaming', 'kuendigungsbestaetigung-anfordern'], 'dsgvo löschung daten löschen art 17 werbung',
  frm=JANA, to={'org': 'Muster Shopping GmbH', 'attn': 'Datenschutzbeauftragte', 'street': 'Handelsweg 3', 'city': '20095 Hamburg'},
  letter=L('Löschung meiner personenbezogenen Daten nach Art. 17 DSGVO – Kundennummer 5544-21',
           ['mein Kundenkonto bei Ihnen ist beendet. Ich fordere Sie daher auf, alle personenbezogenen Daten, die Sie über mich speichern, nach Art. 17 DSGVO unverzüglich zu löschen. Erteilte Einwilligungen, etwa für den Newsletter, widerrufe ich; der Nutzung meiner Daten für Werbung widerspreche ich nach Art. 21 Abs. 2 DSGVO.',
            'Soweit Sie Daten aufgrund gesetzlicher Aufbewahrungspflichten nicht löschen dürfen, schränken Sie bitte deren Verarbeitung ein und teilen mir mit, welche Daten das sind und bis wann sie aufbewahrt werden. Haben Sie meine Daten an andere weitergegeben, informieren Sie diese bitte nach Art. 19 DSGVO über die Löschung.',
            'Bitte bestätigen Sie mir die Löschung innerhalb eines Monats.']),
  en={'name': 'Erasure request (GDPR Art. 17)', 'slug': 'gdpr-erasure-request', 'short': 'Ask a company to delete your personal data',
      'desc': 'Free GDPR erasure request template (Art. 17, “right to be forgotten”): ask a company to delete your data and confirm it – exceptions and deadline explained.',
      'h1': 'Erasure request under the GDPR (Art. 17)',
      'when': ['You have closed an account, receive marketing you do not want or simply no longer want to be in a customer database. Under Article 17 GDPR you can ask for your data to be erased – for example when it is no longer needed or you withdraw your consent.',
               'Data the company must keep by law, such as invoices for the tax office, may be kept but only used for that purpose.'],
      'must': ['Details that identify you', 'The request to erase under Art. 17 GDPR', 'Withdrawal of consent and objection to marketing', 'A request to inform recipients (Art. 19)', 'A request for confirmation – deadline one month'],
      'notes': ['If you only want to stop marketing, an objection under Art. 21(2) is enough – the template includes it.', 'If data is kept because of legal retention duties, it must be restricted and you must be told why.', 'If nobody answers, complain to the data protection supervisory authority.'],
      'faq': [{'q': 'Do I have to say why?', 'a': 'No detailed reason is needed, but it helps to name one briefly, such as “contract ended” or “consent withdrawn”.'}],
      'from': EN_GDPR_FROM, 'to': {'org': 'Example Shopping Ltd', 'attn': 'Data Protection Officer', 'street': '3 Market Way', 'city': 'London EC1A 1AA'},
      'letter': L('Erasure of my personal data under Article 17 GDPR – customer number 5544-21',
                  ['My customer account with you has ended. I therefore ask you to erase without undue delay all personal data you hold about me under Article 17 GDPR. I withdraw any consent I have given, for example for your newsletter, and I object to the use of my data for marketing under Article 21(2) GDPR.',
                   'Where you may not erase data because of legal retention duties, please restrict its processing and tell me which data this is and how long it will be kept. If you have shared my data with others, please inform them of the erasure under Article 19 GDPR.',
                   'Please confirm the erasure within one month.'],
                  salutation='Dear Sir or Madam,', closing='Yours faithfully,'),
      'fields': {'notice': 'none'}})

# ================================================================== Schule & Familie
B('entschuldigung-schule', 'familie', 'din-letter', 'Entschuldigung für die Schule', 'Fehlen des Kindes wegen Krankheit entschuldigen',
  'Entschuldigung für die Schule als Vorlage: Fehlzeit des Kindes wegen Krankheit schriftlich entschuldigen – mit Hinweisen zu Fristen und Attest. Ausfüllen, drucken, unterschreiben.',
  ['Dein Kind war krank und konnte nicht zur Schule. Die meisten Schulen verlangen, dass du am ersten Tag morgens anrufst oder eine Nachricht schickst und das Fehlen danach schriftlich entschuldigst. Wann die schriftliche Entschuldigung da sein muss, regeln Schulgesetz und Schulordnung – oft innerhalb von drei Tagen.'],
  ['Name und Klasse des Kindes', 'Zeitraum des Fehlens mit Daten', 'Grund – „Krankheit“ reicht, eine Diagnose nicht nötig', 'Ob ihr am ersten Tag telefonisch Bescheid gegeben habt', 'Unterschrift eines Elternteils'],
  ['Bei längeren Fehlzeiten oder kurz vor Klassenarbeiten kann die Schule ein ärztliches Attest verlangen.', 'Volljährige Schülerinnen und Schüler entschuldigen sich in der Regel selbst.', 'Für Termine wie eine Familienfeier brauchst du vorher eine Beurlaubung – nachträglich entschuldigen geht dafür meist nicht.'],
  [('Muss ich die Krankheit genau beschreiben?', 'Nein. „Wegen Krankheit“ genügt. Nur wenn eine ansteckende Krankheit wie Läuse oder Scharlach dahintersteckt, muss die Schule das wissen.')],
  {'notice': 'none', 'folds': True}, ['einverstaendnis-klassenfahrt', 'vollmacht-kind-abholen', 'kuendigung-kita-platz'], 'schule entschuldigung kind krank fehlen eltern',
  frm=KATRIN, to={'org': 'Muster-Grundschule', 'attn': 'Frau Peters, Klassenlehrerin der 3b', 'street': 'Schulstraße 5', 'city': '79102 Freiburg im Breisgau'},
  letter=L('Entschuldigung für Paul Neumann, Klasse 3b',
           ['mein Sohn Paul konnte vom [Datum] bis einschließlich [Datum] wegen Krankheit nicht am Unterricht teilnehmen. Am ersten Tag habe ich ihn morgens telefonisch im Sekretariat abgemeldet.',
            'Bitte entschuldigen Sie sein Fehlen. Die Hausaufgaben aus diesen Tagen holt Paul bis Ende der Woche nach; seine Sitznachbarin hat ihm die Arbeitsblätter schon mitgebracht.'],
           salutation='Sehr geehrte Frau Peters,'))

B('einverstaendnis-klassenfahrt', 'familie', 'din-letter', 'Einverständniserklärung Klassenfahrt', 'Erlaubnis, Notfallkontakt und wichtige Hinweise',
  'Einverständniserklärung für die Klassenfahrt als Muster: Teilnahme, Notfallnummer, Allergien, Medikamente und Erlaubnisse wie Schwimmen – ausfüllen und unterschreiben.',
  ['Vor einer Klassenfahrt oder einem Schullandheim braucht die Schule eine schriftliche Erklärung der Eltern. Oft gibt die Schule ein eigenes Formular aus – dann nimm das. Fehlt es oder willst du zusätzliche Hinweise geben, hilft diese Vorlage.'],
  ['Name und Klasse des Kindes, Ziel und Zeitraum der Fahrt', 'Eure Erreichbarkeit während der Fahrt', 'Allergien, Unverträglichkeiten, Medikamente', 'Erlaubnisse: Schwimmen, Freizeit in kleinen Gruppen ohne Aufsicht, Fotos', 'Unterschrift aller Sorgeberechtigten'],
  ['Medikamente gibst du mit Einnahmeplan und genauer Dosierung mit – am besten in der Originalverpackung.', 'Ob dein Kind schwimmen darf, hängt auch davon ab, wie sicher es schwimmt. Schreib das ehrlich dazu.', 'Bei gemeinsamem Sorgerecht unterschreiben beide Elternteile.'],
  [('Was ist mit der Krankenversicherungskarte?', 'Gib die Gesundheitskarte oder eine Kopie mit, je nachdem, was die Schule wünscht. Für Fahrten ins Ausland ist die Rückseite der Karte (Europäische Krankenversicherungskarte) wichtig.')],
  {'notice': 'none'}, ['entschuldigung-schule', 'vollmacht-kind-abholen', 'kuendigung-kita-platz'], 'klassenfahrt schullandheim einverständnis eltern erlaubnis',
  frm=KATRIN, to={'org': 'Muster-Gymnasium', 'attn': 'Herr Kurz, Klassenleitung 7a', 'street': 'Schulweg 12', 'city': '79100 Freiburg im Breisgau'},
  letter=L('Einverständniserklärung zur Klassenfahrt der 7a nach [Ziel] vom [Datum] bis [Datum]',
           ['wir sind damit einverstanden, dass unsere Tochter Lena Neumann an der Klassenfahrt teilnimmt. Während der Fahrt sind wir unter 0761 1234567 und 0151 98765432 erreichbar.',
            'Lena hat eine Nussallergie (Haselnuss und Walnuss) und nimmt keine regelmäßigen Medikamente. Ein Notfallset mit Anleitung geben wir ihr mit. Sie schwimmt sicher und darf unter Aufsicht schwimmen gehen. In der Freizeit darf sie sich in Gruppen von mindestens drei Kindern ohne Begleitung im Ort bewegen, wenn die Lehrkräfte das erlauben.',
            'Fotos, auf denen Lena zu sehen ist, dürfen für den Klassenrückblick, aber nicht auf der Website der Schule verwendet werden.'],
           salutation='Sehr geehrter Herr Kurz,'))

# ================================================================== Vollmachten
for ident, purpose, name, short, desc, when, must, notes, faq, f_extra, doc_text, rel, srch in [
    ('vollmacht-post', 'post', 'Vollmacht zur Abholung von Post und Paketen', 'Jemand anderen Briefe und Pakete abholen lassen',
     'Vollmacht für Post und Pakete: Muster, damit eine Vertrauensperson Sendungen und Einschreiben in der Filiale oder im Paketshop für dich abholen darf – als PDF.',
     ['Du kannst eine Sendung nicht selbst abholen – du bist krank, verreist oder arbeitest zu den Öffnungszeiten. Mit dieser Vollmacht darf eine andere Person Briefe, Pakete und Einschreiben für dich abholen und den Empfang quittieren.'],
     ['Deine Daten (Vollmachtgeber)', 'Name und Anschrift der Person, die abholt', 'Was abgeholt werden darf und wo', 'Gültigkeit – ein Tag, ein Zeitraum oder bis auf Widerruf', 'Deine Unterschrift'],
     ['Die abholende Person braucht ihren eigenen Ausweis, oft auch eine Kopie deines Ausweises oder den Benachrichtigungsschein.', 'Manche Paketdienste haben eigene Vollmachtsformulare oder lassen die Vollmacht direkt in der App erteilen.', 'Für behördliche Schreiben mit Zustellungsurkunde gelten eigene Regeln.'],
     [('Darf ich auch eine Dauer-Vollmacht ausstellen?', 'Ja, „bis auf Widerruf“. Gib sie aber nur Menschen, denen du wirklich vertraust, und widerrufe sie schriftlich, wenn sie nicht mehr gelten soll.')],
     {'where': 'Postfiliale am Marktplatz', 'valid': 'period'},
     'Hiermit bevollmächtige ich …, für mich bestimmte Briefe, Pakete und sonstige Sendungen – auch Einschreiben und Nachnahmesendungen – bei Postfiliale am Marktplatz abzuholen, in Empfang zu nehmen und den Empfang zu quittieren.',
     ['vollmacht-behoerde', 'vollmacht-wohnungsuebergabe', 'quittung-privatverkauf'], 'post paket abholen vollmacht einschreiben'),
    ('vollmacht-behoerde', 'authority', 'Vollmacht für einen Behördengang', 'Jemanden zum Amt schicken',
     'Vollmacht für Behördengänge: Muster, damit eine Vertrauensperson bei Amt oder Bürgerbüro für dich Anträge stellt oder Dokumente abholt – mit Hinweisen, was persönlich sein muss.',
     ['Du kannst einen Termin beim Amt nicht selbst wahrnehmen und möchtest jemanden schicken – etwa um einen fertigen Ausweis abzuholen, Unterlagen einzureichen oder eine Bescheinigung zu beantragen.'],
     ['Deine Daten mit Geburtsdatum', 'Name und Anschrift der bevollmächtigten Person', 'Die Behörde und die konkrete Angelegenheit', 'Gültigkeit', 'Deine Unterschrift'],
     ['Manches geht nur persönlich, etwa der Antrag auf einen Personalausweis oder Reisepass (Fingerabdrücke, Unterschrift). Das Abholen ist mit Vollmacht dagegen oft möglich – frag vorher beim Amt.', 'Viele Ämter haben eigene Vollmachtsformulare auf ihrer Website.', 'Die bevollmächtigte Person bringt ihren Ausweis und deinen Ausweis bzw. eine Kopie mit.'],
     [('Wie genau muss ich die Angelegenheit beschreiben?', 'So konkret wie möglich, z. B. „Abholung meines neuen Personalausweises“. Eine zu allgemeine Vollmacht wird oft nicht akzeptiert.')],
     {'office': 'Bürgerbüro der Stadt Musterstadt', 'matter': 'Abholung meines neuen Personalausweises', 'valid': 'revoke'},
     'Hiermit bevollmächtige ich …, mich gegenüber Bürgerbüro der Stadt Musterstadt in folgender Angelegenheit zu vertreten: Abholung meines neuen Personalausweises. Die Vollmacht umfasst das Stellen von Anträgen, die Abgabe und Entgegennahme von Erklärungen und Unterlagen sowie die Abholung von Bescheiden und Dokumenten.',
     ['vollmacht-post', 'vollmacht-kfz-zulassung', 'widerspruch-bescheid'], 'amt behörde bürgerbüro vollmacht ausweis abholen'),
    ('vollmacht-kfz-zulassung', 'vehicle', 'Vollmacht für die Kfz-Zulassung', 'Auto an-, ab- oder ummelden lassen',
     'Vollmacht für die Zulassungsstelle: Muster, um ein Auto von einer anderen Person anmelden, abmelden oder ummelden zu lassen – mit Liste der nötigen Unterlagen.',
     ['Du willst dein Auto zulassen, abmelden oder umschreiben, hast aber keine Zeit für die Zulassungsstelle. Mit dieser Vollmacht kann eine andere Person den Termin für dich übernehmen.'],
     ['Deine Daten als Halterin oder Halter', 'Name und Anschrift der bevollmächtigten Person', 'Was erledigt werden soll: Zulassung, Abmeldung oder Umschreibung', 'Kennzeichen und Fahrzeug-Identifizierungsnummer', 'Unterschrift'],
     ['Für die Zulassung braucht die bevollmächtigte Person meist auch deinen Ausweis oder eine Kopie, die Zulassungsbescheinigungen Teil I und II, die elektronische Versicherungsbestätigung (eVB) und ein SEPA-Mandat für die Kfz-Steuer.', 'Viele Zulassungsstellen haben ein eigenes Vollmachtsformular – das wird dort am schnellsten akzeptiert.', 'Abmelden geht in vielen Fällen auch online.'],
     [('Kann auch ein Zulassungsdienst die Vollmacht nutzen?', 'Ja. Trag dann den Namen des Dienstes oder der Person ein, die den Termin übernimmt.')],
     {'action': 'zul', 'plate': 'KS-AB 123', 'vin': 'WVWZZZ1KZ6W000001', 'office': 'Zulassungsstelle Musterstadt', 'valid': 'period'},
     'Hiermit bevollmächtige ich …, für mich bei Zulassungsstelle Musterstadt die Zulassung des Fahrzeugs mit dem Kennzeichen KS-AB 123 (FIN WVWZZZ1KZ6W000001) zu beantragen, alle dafür nötigen Erklärungen abzugeben und Unterlagen, Kennzeichen und Plaketten entgegenzunehmen.',
     ['vollmacht-behoerde', 'kuendigung-kfz-versicherung', 'vollmacht-post'], 'auto zulassung anmelden abmelden kennzeichen vollmacht'),
    ('vollmacht-kind-abholen', 'child', 'Vollmacht zur Abholung des Kindes', 'Kind von Kita, Schule oder Verein abholen lassen',
     'Abholvollmacht für Kita und Schule: Muster, damit Großeltern, Nachbarn oder Freunde dein Kind abholen dürfen – mit Gültigkeit und Unterschrift beider Eltern.',
     ['Jemand anderes soll dein Kind von der Kita, der Schule oder dem Training abholen – regelmäßig oder an einem bestimmten Tag. Viele Einrichtungen geben Kinder nur an Personen heraus, die schriftlich bevollmächtigt sind.'],
     ['Name und Geburtsdatum des Kindes', 'Name und Anschrift der abholenden Person', 'Einrichtung', 'Gültigkeit – ein Tag, ein Zeitraum oder bis auf Widerruf', 'Unterschrift der Sorgeberechtigten'],
     ['Stell die abholende Person in der Einrichtung am besten einmal vor.', 'Die abholende Person sollte ihren Ausweis dabeihaben.', 'Bei gemeinsamem Sorgerecht unterschreiben beide Elternteile.'],
     [('Dürfen auch ältere Geschwister abholen?', 'Das entscheidet die Einrichtung; viele Kitas verlangen ein Mindestalter, oft zwölf oder 14 Jahre. Frag nach.')],
     {'childName': 'Mia Neumann', 'institution': 'Kita Sonnenblume', 'valid': 'revoke'},
     'Hiermit bevollmächtige ich …, mein Kind Mia Neumann aus der Einrichtung Kita Sonnenblume abzuholen.',
     ['einverstaendnis-klassenfahrt', 'kuendigung-kita-platz', 'entschuldigung-schule'], 'kita schule kind abholen oma vollmacht'),
]:
    g = KATRIN if purpose == 'child' else THOMAS
    agent = ['Brigitte Neumann', 'Am Rebhang 2', '79112 Freiburg im Breisgau'] if purpose == 'child' else ['Ingrid Muster', 'Weserstraße 19', '34125 Kassel']
    B(ident, 'vollmacht', 'power-of-attorney', name, short, desc, when, must, notes, faq,
      {'purpose': purpose, 'gName': g[0], 'gStreet': g[1], 'gCity': g[2], 'aName': agent[0], 'aStreet': agent[1], 'aCity': agent[2], **f_extra},
      rel, srch,
      doc=[['Vollmachtgeber/in', ', '.join(g)], ['Bevollmächtigte Person', ', '.join(agent)], ['Text', doc_text],
           ['Gültigkeit', {'day': 'An einem Tag', 'period': 'Für einen Zeitraum (Von – bis)', 'revoke': 'Bis auf Widerruf'}[f_extra['valid']]],
           ['Unterschriften', 'Vollmachtgeber/in; Unterschriftsprobe der bevollmächtigten Person']])

# ================================================================== Kauf & Geld
B('widerruf-onlinekauf', 'kauf', 'withdrawal-letter', 'Widerruf eines Onlinekaufs', 'Bestellung innerhalb von 14 Tagen widerrufen',
  'Widerruf für Onlinekäufe als Muster: Bestellung innerhalb der 14-Tage-Frist widerrufen, Erstattung inklusive Versandkosten verlangen – vorausgefüllt als PDF.',
  ['Du hast etwas im Internet, am Telefon oder per Katalog bestellt und willst es doch nicht behalten. Als Verbraucher kannst du solche Verträge in der Regel innerhalb von 14 Tagen ohne Grund widerrufen. Die Frist beginnt bei Waren meist mit dem Tag, an dem du die Ware bekommen hast.',
   'Das Zurückschicken allein ist oft kein wirksamer Widerruf – du musst ihn eindeutig erklären. Ein kurzer Brief oder eine E-Mail mit diesem Text reicht.'],
  ['Bestellnummer und Bestelldatum', 'Welche Waren du zurückgibst', 'Datum, an dem du die Ware erhalten hast', 'Die Bitte um Erstattung aller Zahlungen inklusive der ursprünglichen Versandkosten', 'Bitte um Bestätigung'],
  ['Die Kosten der Rücksendung musst du tragen, wenn der Händler vorher darauf hingewiesen hat – viele übernehmen sie trotzdem.', 'Der Händler muss innerhalb von 14 Tagen erstatten, darf aber warten, bis die Ware zurück ist oder du den Versand nachweist.', 'Kein Widerrufsrecht gibt es zum Beispiel bei maßgefertigter Ware, schnell verderblichen Lebensmitteln oder entsiegelter Software.'],
  [('Reicht es, das Paket einfach zurückzuschicken?', 'Nicht sicher. Seit 2014 musst du den Widerruf ausdrücklich erklären. Leg den Brief ins Paket und schick ihn zusätzlich per E-Mail.')],
  {'kind': 'goods', 'orderNo': '2026-118823', 'customerNo': 'K-55 210', 'items': 'Winterjacke, Größe M, Farbe Blau\nMütze, Farbe Grau', 'refund': True, 'confirm': True, 'label': True},
  ['widerruf-dienstleistung', 'beschwerde', 'kuendigungsbestaetigung-anfordern'], 'widerruf rückgabe online bestellung 14 tage',
  frm=JANA, to={'org': 'Musterversand GmbH', 'attn': 'Retourenabteilung', 'street': 'Logistikring 7', 'city': '54294 Trier'},
  doc=[['Betreff', 'Widerruf meiner Bestellung 2026-118823'],
       ['Text', 'Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über den Kauf der folgenden Waren (Bestellnummer 2026-118823): – Winterjacke, Größe M, Farbe Blau – Mütze, Farbe Grau. Bestellt am …, erhalten am … Bitte erstatten Sie mir alle geleisteten Zahlungen einschließlich der Kosten der ursprünglichen Lieferung über das Zahlungsmittel, das ich bei der Bestellung verwendet habe. Bitte senden Sie mir für die Rücksendung ein Retourenetikett … Bitte bestätigen Sie mir den Eingang dieses Widerrufs.'],
       ['Absender / Empfänger', 'Jana Beispiel → Musterversand GmbH, Retourenabteilung'], ['Infoblock', 'Bestellnummer, Kundennummer, Datum']],
  doc_intro='Das Werkzeug setzt den Widerruf als Brief nach DIN 5008. Mit den Beispieldaten steht darin:')

B('widerruf-dienstleistung', 'kauf', 'withdrawal-letter', 'Widerruf eines Dienstleistungsvertrags', 'Online oder am Telefon geschlossenen Vertrag widerrufen',
  'Dienstleistungsvertrag widerrufen: Muster für Verträge, die online, am Telefon oder an der Haustür geschlossen wurden – mit 14-Tage-Frist und Hinweisen zu Wertersatz.',
  ['Am Telefon wurde dir ein neuer Stromtarif, ein Zeitschriftenpaket oder ein Handwerkerauftrag verkauft, oder du hast online einen Dienst gebucht und es bereut. Bei Verträgen außerhalb von Geschäftsräumen und im Fernabsatz hast du als Verbraucher meist 14 Tage Zeit zum Widerruf – bei Dienstleistungen ab Vertragsschluss.'],
  ['Was für ein Vertrag es ist und mit wem', 'Datum des Vertragsschlusses', 'Vertrags- oder Kundennummer', 'Klarer Widerruf und Bitte um Erstattung', 'Bitte um Bestätigung'],
  ['Hast du verlangt, dass die Leistung schon während der Widerrufsfrist beginnt, musst du für das bereits Geleistete eventuell anteilig zahlen (Wertersatz).', 'Wurdest du nicht richtig über das Widerrufsrecht belehrt, verlängert sich die Frist – höchstens auf ein Jahr und 14 Tage.', 'Am Telefon untergeschobene Verträge kannst du auch widerrufen, wenn du dich an keine Zustimmung erinnerst – sicher ist sicher.'],
  [('Was ist, wenn die Dienstleistung schon komplett erbracht ist?', 'Dann kann das Widerrufsrecht erloschen sein, wenn du ausdrücklich zugestimmt hast, dass vor Ablauf der Frist begonnen wird. Lass dich in diesem Fall beraten.')],
  {'kind': 'service', 'orderNo': 'V-2026-0912', 'customerNo': '', 'items': 'Jahresabo „Sprachkurs online Plus“', 'refund': True, 'confirm': True},
  ['widerruf-onlinekauf', 'kuendigung-streaming', 'beschwerde'], 'widerruf vertrag telefon haustür dienstleistung',
  frm=MARKUS, to={'org': 'Lernmuster Online GmbH', 'attn': 'Kundenservice', 'street': 'Akademiestraße 4', 'city': '54290 Trier'},
  doc=[['Betreff', 'Widerruf meiner Bestellung V-2026-0912'],
       ['Text', 'Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (Bestellnummer V-2026-0912): – Jahresabo „Sprachkurs online Plus“. Bestellt am … Bitte erstatten Sie mir alle geleisteten Zahlungen … Bitte bestätigen Sie mir den Eingang dieses Widerrufs.'],
       ['Absender / Empfänger', 'Markus Probe → Lernmuster Online GmbH, Kundenservice']],
  doc_intro='Das Werkzeug setzt den Widerruf als Brief nach DIN 5008. Mit den Beispieldaten steht darin:')

B('zahlungserinnerung', 'kauf', 'payment-reminder', 'Zahlungserinnerung', 'Freundlich an eine offene Rechnung erinnern',
  'Zahlungserinnerung schreiben: Vorlage mit offener Rechnung, neuer Frist und Bankverbindung – freundlich im Ton, auf Wunsch mit Mahnstufe und Verzugszinsen.',
  ['Ein Kunde hat eine Rechnung nicht bezahlt, die Frist ist abgelaufen. Meist ist es ein Versehen – eine freundliche Zahlungserinnerung mit neuer Frist klärt das am schnellsten. Erst wenn darauf nichts kommt, folgen Mahnungen.'],
  ['Rechnungsnummer, Rechnungsdatum und Betrag', 'Ursprüngliche Fälligkeit', 'Eine neue, konkrete Zahlungsfrist', 'Bankverbindung', 'Ein freundlicher Satz für den Fall, dass sich das Schreiben mit der Zahlung überschnitten hat'],
  ['Bei Verbrauchern tritt Verzug spätestens 30 Tage nach Fälligkeit und Zugang der Rechnung ein, wenn auf der Rechnung darauf hingewiesen wurde – sonst in der Regel erst mit einer Mahnung.', 'Ab Verzug kannst du Verzugszinsen verlangen; bei Geschäftskunden zusätzlich eine Pauschale von 40 Euro. Das Werkzeug rechnet beides auf Wunsch aus.', 'Behalte die Übersicht über alle offenen Rechnungen mit der Rechnungs-Mahnliste.'],
  [('Wie viele Mahnungen muss ich schicken?', 'Keine bestimmte Zahl. Üblich sind eine Zahlungserinnerung und ein bis zwei Mahnungen, bevor man ein gerichtliches Mahnverfahren oder ein Inkassobüro einschaltet.')],
  {'level': 'reminder', 'tone': 'friendly', 'customerNo': 'K-1042', 'invoices': [{'no': 'RE-2026-118', 'date': '', 'due': '', 'amount': '480,00', 'paid': ''}],
   'bank': 'Musterbank Saar', 'iban': 'DE00 1234 5678 9012 3456 78', 'bic': '', 'holder': 'Jana Beispiel Grafikdesign'},
  ['beschwerde', 'quittung-privatverkauf', 'widerruf-onlinekauf'], 'mahnung zahlungserinnerung rechnung offen kunde',
  frm=['Jana Beispiel Grafikdesign', 'Lindenstraße 12', '66111 Saarbrücken'], to={'org': 'Bäckerei Sonnenschein', 'attn': 'Herrn Albert Sonnenschein', 'street': 'Marktplatz 3', 'city': '66111 Saarbrücken'},
  doc=[['Stufe', 'Zahlungserinnerung, Ton freundlich'], ['Rechnung', 'RE-2026-118 über 480,00 € (Datum und Fälligkeit trägst du ein)'], ['Text', 'Sicher ist es Ihnen im Alltag durchgerutscht: Die Rechnung … ist noch offen. Bitte überweisen Sie den Betrag bis zum … auf das unten genannte Konto. Sollten Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.'],
       ['Bankverbindung', 'Musterbank Saar, IBAN DE00 1234 5678 9012 3456 78'], ['Optional', 'Verzugszinsen und Pauschale ab der 1. Mahnung']],
  doc_intro='Das Werkzeug schreibt die Erinnerung je nach Stufe und Tonfall selbst. Mit den Beispieldaten ist sie so aufgebaut:')

B('quittung-privatverkauf', 'kauf', 'receipt', 'Quittung für einen Privatverkauf', 'Barzahlung beim Verkauf bestätigen',
  'Quittung für den Privatverkauf: Vorlage für Bargeld beim Verkauf von Fahrrad, Möbeln oder Auto – Betrag in Ziffern und Worten, Zweck, Unterschrift. Als PDF.',
  ['Du verkaufst etwas privat – ein Fahrrad, ein Sofa, eine Kamera – und bekommst Bargeld. Mit einer Quittung bestätigst du, dass das Geld angekommen ist. Das schützt beide Seiten, falls es später Streit gibt.'],
  ['Betrag in Ziffern und in Worten', 'Wofür: der verkaufte Gegenstand, möglichst genau (z. B. Rahmennummer)', 'Name und Anschrift von Käufer und Verkäufer', 'Datum und Ort', 'Unterschrift der Person, die das Geld bekommt'],
  ['Bei privaten Verkäufen kannst du die Gewährleistung ausschließen – das gehört aber in einen Kaufvertrag, nicht in die Quittung. Für teure Dinge wie ein Auto ist ein schriftlicher Kaufvertrag sinnvoll.', 'Die Quittung bekommt der Käufer; eine Kopie behältst du.', 'Umsatzsteuer weist du als Privatperson nicht aus.'],
  [('Muss der Betrag in Worten drauf?', 'Es ist nicht vorgeschrieben, macht spätere Änderungen aber schwerer. Das Werkzeug schreibt den Betrag automatisch in Worten aus.')],
  {'amount': '350,00', 'purpose': 'Trekkingrad „Tourer 28“, Rahmennummer WTU 123456, gebraucht wie besichtigt', 'payer': 'Jonas Muster', 'payerAddr': 'Kirchgasse 9, 66119 Saarbrücken',
   'receiver': 'Jana Beispiel', 'receiverAddr': 'Lindenstraße 12, 66111 Saarbrücken', 'pay': 'cash', 'vat': 'none', 'place': 'Saarbrücken', 'number': ''},
  ['zahlungserinnerung', 'widerruf-onlinekauf', 'vollmacht-post'], 'quittung bar verkauf privat fahrrad beleg',
  doc=[['Betrag', '350,00 € – in Worten: dreihundertfünfzig Euro'], ['Für', 'Trekkingrad „Tourer 28“, Rahmennummer WTU 123456, gebraucht wie besichtigt'], ['Von', 'Jonas Muster, Kirchgasse 9, 66119 Saarbrücken'],
       ['Erhalten von', 'Jana Beispiel, Lindenstraße 12, 66111 Saarbrücken'], ['Zahlungsart', 'Bar'], ['Ort, Datum, Unterschrift', 'Saarbrücken, Datum des Verkaufs, Unterschrift der Verkäuferin']],
  doc_intro='Die Quittung ist ein Beleg, kein Brief. Mit den Beispieldaten steht darauf:')
print('briefe:', len(list(OUT.glob('*.json'))))
