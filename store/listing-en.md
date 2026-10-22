# Store listing (English) – Google Play

> Google Play limits: title ≤ 30, short description ≤ 80, full description ≤ 4000 characters.
> Do not use other companies' trademarks (no names of other PDF/office apps or vendor product
> names). Naming file formats (PDF, DOCX, XLSX, PPTX) is fine.
> The app UI follows the device language automatically (no language switch): German, English, French,
> Spanish, Italian, Portuguese (Brazil), Dutch, Polish, Turkish, Ukrainian, Russian, Chinese (Simplified), Japanese,
> Korean, Hindi, Indonesian. Translated store listings: `store/listings/<lang>.md`.
> Feature names below match the English UI (e.g. "Fill & Sign", "Organize pages", "Reading mode", "Redact", "Letters & templates"). The letter generators for cancellations, withdrawals,
> objections etc. follow German law and create German letters – they are labelled "(Germany)" in the app.
> Check the limits after every edit: `python3 store/check_listing.py`

## Play Console declarations

- **Contains ads**: **yes** (must be set to "Yes" in the Play Console) – Google AdMob in the Android app: a small, labelled banner at the bottom of the main pages (Home, Files, Tools, Me), never inside documents, tools or editors; FaLe Plus removes it. Plus voluntary rewarded video ads for extra AI requests. The web/Windows version shows no ads.
- **In-app purchases**: yes – the "FaLe Plus" subscription (more AI requests per day), the one-time "FaLe Plus forever" (`fale_plus_lifetime`) and voluntary thank-you tips (`fale_tip_small` / `_medium` / `_large`, consumable); prices are set in the Play Console.
- **AI-generated content**: the optional cloud AI is disclosed in the description, incl. how to report problematic answers (contact email).

## App name (≤ 30)

```
FaLe PDF – PDF & Office
```

## Short description (≤ 80)

```
Sign, scan with text recognition & edit PDFs – private, works offline.
```

## Full description (≤ 4000)

```
FaLe PDF is your private office for phone and tablet: read, fill in, sign, scan and edit PDFs – plus documents, spreadsheets and presentations. The pro features are included too – no account, no watermarks. Your files are processed on your device. Optionally, the FaLe account syncs them end-to-end encrypted between your devices.

READ PDFS
• Fast PDF viewer with search, bookmarks and outline
• Reading mode: text reflowed for your phone, with font size, sepia and dark
• Read aloud

FILL & SIGN
• Fill in PDF forms
• Draw and save your signature, place it with one tap
• Dates, text, initials and your own stamps

SCAN WITH TEXT RECOGNITION
• Camera scanner: detects edges, straightens pages, improves contrast
• Text recognition (OCR) on your device – even offline: scans become searchable
• Copy text from photos, image to DOCX or XLSX
• ID cards, business cards, passport photos and QR codes

ANNOTATE & EDIT
• Highlights, notes, freehand drawing and shapes
• Add or replace text and images
• Redact: permanently remove confidential content
• Watermarks, page numbers, headers and footers

PAGES & FILES
• Merge, reorder, rotate, extract and crop pages
• Compress PDFs, batch processing
• Add and remove password protection (AES-256)
• Compare two PDF versions
• 40 extra tools: PDF/A, letterhead, booklet, pages per sheet, PDF repair, background removal

CONVERT
• PDF to DOCX, XLSX and PPTX – and back to PDF
• Images to PDF, export pages as images or text

DOCUMENTS, SPREADSHEETS, PRESENTATIONS
• Open, edit and create DOCX, XLSX and PPTX
• Spreadsheets with formulas and charts
• Around 100 templates: CVs, invoices, calendars, vouchers, contracts, slide designs
• Crash-safe – and, if you like, save straight into the original file
• Letter generators for Germany (cancellation, withdrawal, objection – the letters are written in German)

EVERYDAY
• Deadlines & reminders, so no notice period slips by
• Private vault protected by your own PIN
• "Open with" and "Share": take files straight from email, messengers or your file manager
• Saved files go to the "Documents/FaLe PDF" folder

SHARE, GET SIGNATURES, TRANSFER
• Share securely: end-to-end encrypted link that expires automatically (1 hour to 7 days), optional password and download limit
• Request a signature: place fields, send the link via messenger or email – the other person signs in the browser, no account, with an audit page (simple electronic signature)
• Connect devices: transfer files between phone and PC via QR code – direct and encrypted

AI ASSISTANT (OPTIONAL)
• Chat with a document: ask questions, get answers with page references
• Summarize, translate, writing help, formula assistant, slides by AI
• Flashcards & quizzes from your notes, letters by AI, translate photos
• A few requests included every day, no account needed. More: a voluntary video ad or FaLe Plus
• Don’t want AI? One switch hides it completely
• Only with your consent; only the text you select is sent. AI answers can contain mistakes – you can report problematic answers to us by email.

FAIR AND TRANSPARENT
• The app shows a small banner ad on its main pages – ad-free with FaLe Plus.
• No trial that silently turns into a paid plan, no pop-ups when you save
• FaLe Plus as a subscription or pay once, forever – cancel with one tap, reminder before every renewal

PRIVATE BY DESIGN
No account needed, no analytics. Optional FaLe account: FaLe Sync (end-to-end encrypted, servers in Frankfurt – we cannot read anything) and FaLe Plus on all your devices. You can get extra AI requests by watching an optional video ad. The camera is only used for scanning, notifications only for reminders you set yourself. Everything except the cloud AI, sharing and transfer works offline. Shared files are end-to-end encrypted – we cannot read them.

Speaks your language: the app follows your phone's language automatically. No watermarks. Optional: FaLe Plus for more AI requests.
```

## Feature bullets

- All pro features on board – no account, no watermarks
- The Android app shows a small banner ad on its main pages – ad-free with FaLe Plus
- Fill in and sign PDFs
- Scan with edge detection and offline text recognition (OCR)
- AI assistant: ask your documents, with page references (optional)
- Share securely & request signatures – end-to-end encrypted, no account
- Phone ↔ PC: transfer files via QR code
- Optional: FaLe Sync – end-to-end encrypted on all your devices
- Edit documents, spreadsheets and presentations
- Convert PDF ↔ DOCX, XLSX, PPTX
- Deadlines, reminders and a private vault
- Your files stay on your device

## Graphics & screenshots (Play Console)

All files are in `store/graphics/` – see `store/graphics/README.md` for the Play Console slot of each file.
Phone screenshot order (English) with the caption shown in the image:

1. `phone/en/01_home.png` – "All pro features on board"
2. `phone/en/02_sign.png` – "Sign in seconds"
3. `phone/en/03_scan.png` – "Scan with edge detection"
4. `phone/en/04_ocr.png` – "Text recognition, offline"
5. `phone/en/05_ai.png` – "AI assistant for your documents" (optional, only with your consent)
6. `phone/en/06_sheet.png` – "Documents, spreadsheets & slides"
7. `phone/en/07_reminders.png` – "Never miss a deadline"
8. `phone/en/08_privacy.png` – "Your files stay on your phone"
