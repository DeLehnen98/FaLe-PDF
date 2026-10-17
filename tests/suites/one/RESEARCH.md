# FaLe One (Drive + Fotos): market research

Research date: 2026-10-15. Prices are taken from the cited pages where possible. Anything marked **(est.)** is my estimate, and anything marked **(verify)** comes from an older or third-party source. USD is converted at 1 USD ≈ 0.86 EUR **(est.)**. All quotes are under 15 words and attributed to their source. Where a source paraphrased a user, the quote is marked "paraphrase".

---

## 0. TL;DR

- **The biggest pains, roughly in order of how often they appear:**
  1. Storage nagging, upsells and a pool shared with mail.
  2. Price hikes and plan cuts. The latest is M365 Family going from 6 TB to 2 TB shared (Oct 2026).
  3. Backups that silently stop or crawl.
  4. Deletion confusion and data loss.
  5. Account lockouts with no human to talk to.
  6. AI scanning and default-on privacy changes.
  7. Painful exit (Google Takeout).
  8. Sync duplicates and conflicts.
  9. Clutter, worse search and weak organisation.
  10. Billing and cancellation traps.
- **The must-haves users love:** set-and-forget background backup, "free up space on the phone", search by face, place and thing, memories, easy link and album sharing, full-quality originals, family plans, version history and trash.
- **Backend:**
  - **Now:** metadata, Auth and quotas stay in Supabase. The encrypted blobs go to **Hetzner Object Storage** (S3, Germany/Finland, about €6.5 per TB-month, €1 per TB egress, requests free).
  - For the closed beta you can stay in Supabase Storage, which is S3-compatible and has 100 GB included in Pro. Write against an S3 adapter from day one.
  - **Later:** add a second cold copy at a different EU provider (Scaleway Glacier about €2.5 per TB-month, or OVH/IONOS). Above roughly 100–200 TB, negotiate or self-host.
  - Avoid Supabase Storage, Scaleway Multi-AZ and R2 for TB plans. At €13–18 per TB they cost 2–3× as much.
- **Free tier:** 10 GB, covering Drive and Fotos only and never mail. On Hetzner even a completely full free user costs about €0.07 per month **(est.)**.
- **Pricing:** 200 GB at €1.99 works (≈53–60 % gross margin). 1 TB at €4.99 is thin: ≈21–31 % at 40 % fill, and a loss if the user fills it. 2 TB at €8.99 is thin too (≈14–25 %). Suggested prices:
  - 200 GB: €1.99 per month / €19.90 per year
  - 1 TB: €5.49–5.99 per month / €54–59 per year
  - 2 TB: €9.99 per month / €99 per year, with Family (6 people) included in the 2 TB plan
  - Push annual and web (Stripe) billing.

---

## 1. Customer pain points (clustered)

"How common" is a qualitative rank based on how often the theme came up across the sources I read: ★★★ appeared in many sources and for several providers, ★★ in several, ★ in a few.

### 1.1 Storage-full nagging, upsell and a quota shared with mail (★★★)

- **Providers:** Google (15 GB shared by Gmail, Drive and Photos), iCloud (5 GB), Amazon, OneDrive.
- **What users say:**
  - "constantly asking to 'make space'" (Google Photos App Store review, justuseapp)
  - "It is using my iPhone photos to prevent me from using Slides and Docs." (Google Photos review, justuseapp)
  - "Google used to be known for its generous free storage" (Android Authority, Feb 2025). The author got an alert on every small upload and his wife paid just to stop the warnings.
  - "Two hours later the number has barely moved." (dev.to, on deleting mail without freeing quota)
  - iCloud Trustpilot (1.3/5): upgrade prompts even when well under the limit.
  - "if you stop paying, Apple will delete them" (iCloud Trustpilot)
- **FaLe answer:**
  - The Drive/Fotos quota is separate and never blocks mail or other apps.
  - Show one calm usage bar. Warn once at 80 % and once at 95 %, with no recurring banners and no dark patterns.
  - Being over quota never deletes anything. Uploads pause, everything stays readable and downloadable, and there is a one-tap "export everything".
  - Built-in "free up space" tools (duplicates, large videos, screenshots) are shown before any upgrade prompt.

### 1.2 Price hikes, plan cuts and broken promises (★★★)

- **Providers:** Microsoft, Google, Dropbox, Amazon (and the end of unlimited Google Photos in 2021).
- **What happened:**
  - **Microsoft 365 Family/Premium (Oct 2026):** went from 6 TB (1 TB × 6 people) to a single 2 TB pool. New customers are affected immediately; existing customers at their first renewal on or after 2 May 2027 (TechRadar, Android Authority).
    - "Greedy company. They never stop do they?" and "they will find many customers cancel the auto renewal now" (TechRadar reader comments)
  - **Microsoft 365 with Copilot (Jan 2025):** +$3 per month, to $99.99/yr Personal and $129.99/yr Family. Customers had to cancel to find the "Classic" plan (Pureinfotech).
  - **Dropbox (2019):** free accounts limited to 3 devices (VentureBeat).
  - **Google:** "google will now be charging for more space" (Google Photos review, justuseapp).
- **FaLe answer:**
  - Publish a **price promise**: existing customers keep their price and quota for as long as they stay subscribed, and any change comes with 12 months' notice and an opt-out.
  - No device limits. Storage is never cut retroactively.
  - Do not bundle AI or other products to justify raising the price.

### 1.3 Backup silently stopping, slow uploads, battery (★★★)

- **Providers:** iCloud, Google Photos, Amazon Photos, Proton Drive, Synology/Nextcloud (OS limits apply to all of them).
- **What users say:**
  - iCloud: about 20,000 items, of which only 4,800 uploaded in 12 hours with the status stuck on "Restoring". Another user saw no progress for 5 days (r/iCloud thread).
  - Amazon Photos: backups stall. "Will need to delete app and re-download." (App Store review)
  - Proton Drive, 50,000 photos: "Die Synchronisation dauert Wochen." (Trustpilot DE, 2.6/5)
  - Background backup stops "when the mobile operating system suspends the app." Causes include Android battery optimisation, OEM sleep lists and iOS Background App Refresh (ZimaSpace).
  - Google removed "back up only while charging" (PhoneArena). Some users rolled back the app to keep it.
- **FaLe answer:**
  - A **visible backup health status**, for example "Last backup: 3 min ago · 0 waiting".
  - A **push or email alert if nothing has backed up for 3 days** even though new photos exist. This is the key differentiator against silent failure.
  - Guided setup for the Android battery-optimisation exemption, with per-OEM instructions.
  - Options: Wi-Fi only, charging only, and a battery-level threshold.
  - Resumable chunked uploads. A first-backup mode that is fast while the app is open (keep the screen awake) and shows an ETA.

### 1.4 Deletion confusion and data loss (★★★)

- **Providers:** Google Photos, iCloud, Amazon, Dropbox, MEGA, pCloud.
- **What users say:**
  - Laptop Mag author: deleting photos in the cloud to free quota also removed them from her phone. She only recovered them from Trash.
  - Google Photos: "when I close GooglePhotos and go back in, they're all back." (review)
  - iCloud Photos "is not a true backup": deletions sync everywhere (r/iCloud reply, paraphrase).
  - Amazon: deleting a folder in the app "also deleted the original file on the hard drive."
  - Dropbox: "my wedding video is gone forever." (Trustpilot 1.3/5)
  - MEGA: "They just deleted all my files that I'd been collecting for years." This was MEGA's inactivity policy (Trustpilot).
  - pCloud: data loss called "a business crippling fail." (Trustpilot)
- **FaLe answer:**
  - Two explicit, separate actions with plain labels: **"Remove from phone (keeps in FaLe)"** and **"Delete everywhere"**.
  - Backup mode is the default: deleting on the phone does **not** delete the backup. Mirror mode is opt-in.
  - A 30-day trash (60 for paid plans) and file version history.
  - No silent deletion of inactive free accounts. If the account is frozen, send 3 emails over 6 months, and the data stays exportable.

### 1.5 Account lockouts and no human support (★★★)

- **Providers:** Google, Apple, Dropbox, Amazon, pCloud.
- **What happened:**
  - A father's medical photos of his son were flagged as CSAM. He permanently lost Google mail, photos and his phone number, even after police cleared him (PetaPixel / NYT, 2022).
  - A 90-year-old woman lost 15 years of Gmail and photos of her late pet, and there was no exception process (Lauren Weinstein blog).
  - "it shouldn't take a freaking week just to get an account recovery" (iCloud Trustpilot)
  - Amazon support "just takes you to a discussion forum."
  - pCloud: "support is non-existent when you need it."
  - Dropbox: "Customer support through chat was no help and terrible."
- **FaLe answer:**
  - E2E encryption means no content scanning, so no false-positive bans of the private library.
  - Recovery is shown clearly at signup: a recovery kit (PDF/QR) plus an optional **trusted recovery contact** / legacy contact.
  - A human email inbox with a stated response-time target (for example 48 h).
  - Any account action is explained and appealable. Lockouts never delete data.

### 1.6 Privacy, AI scanning and default-on changes (★★★)

- **Providers:** Microsoft, Google, Dropbox.
- **What happened:**
  - OneDrive face-grouping AI was on by default, and "You can only turn off this setting 3 times a year." (Reclaim The Net, Oct 2025)
  - Windows 11 turns on OneDrive folder backup "Quietly and without any announcement." (Neowin)
  - Google's "Ask Photos" (Gemini) search: the opt-out was buried and results were worse than classic search. Google added a visible toggle in March 2026 (TechCrunch).
  - Dropbox terms: the service "accesses, stores, and scans Your Stuff." (Trustpilot reviewer)
  - Google Photos links: "Anyone that has the shared link will be able to see the album." (Ubergizmo)
- **FaLe answer:**
  - E2E by default. Search and face recognition run **on the device** (as Ente does). No training on user data, stated in the ToS.
  - Every new feature that touches content is **opt-in**, with an unlimited off switch.
  - Sharing links get optional expiry, a password, and a "view count / revoke" view.

### 1.7 Hard to export or leave (lock-in) (★★)

- **Providers:** Google (Takeout), iCloud, Dropbox.
- **What users say:**
  - Takeout puts metadata in separate JSON sidecars, albums are split across zips, and identically named files collide. "You only have 5 attempts to download." (Ente blog, paraphrase)
  - Without the merge, photos show the wrong date and lose GPS and albums (PixelUnion).
  - iCloud: a "1000 photo limit" on web downloads (Trustpilot).
  - Dropbox: "They make it impossible to cancel."
- **FaLe answer:**
  - **One-click "Export everything"**: originals with EXIF intact, edits applied as sidecars or separate files, a folder per album, and a plain JSON/CSV manifest.
  - Resumable export, and a desktop/CLI sync for an incremental local copy.
  - **Import from Google Takeout** with automatic JSON-to-EXIF merge. This is also a growth channel.
  - Cancel in 2 clicks, in-app and on the web.

### 1.8 Sync conflicts, duplicates and organisation (★★)

- **Providers:** OneDrive, pCloud, iCloud, Amazon, Google.
- **What users say:**
  - OneDrive creates "Filename-DESKTOP-AB12" conflict copies when edits clash (Melbits).
  - pCloud: "Windows desktop application has had a syncing problem since the first version."
  - iCloud Shared Library: duplicates "aren't removed automatically" and must be reviewed by hand (MacRumors).
  - Amazon: "no way to know which pictures I have placed in albums."
- **FaLe answer:**
  - **Content-hash deduplication on upload.** Hash the plaintext on the client and store a keyed hash (HMAC) as metadata, so the same photo is never stored twice and the server learns nothing.
  - A "similar photos" cleanup (bursts, near-duplicates) that runs on the device.
  - Conflicts are shown in-app as "two versions, pick one" instead of silent copies.
  - An "in albums / not in any album" filter.

### 1.9 Search, UI clutter and AI features pushed (★★)

- **Providers:** Amazon, Google, Nextcloud.
- **What users say:**
  - "Please put back a text search box somewhere in the UI." (Amazon Photos review)
  - "no way to correct the many mistakes the facial recognition software makes." (Amazon Photos)
  - The Google Photos grid is "so uneven and eclectic." Archiving is "confusing." (justuseapp, Capterra)
  - Nextcloud is "so slow and bloaty." (self-hosters on Lemmy)
- **FaLe answer:**
  - A fast, plain timeline grid with an adjustable column count. One search box covering dates, places, people and file types, plus optional on-device semantic search.
  - Face labels can be edited, merged and split.
  - No feeds, no AI upsell surfaces, no "creations" spam. Memories can be switched off.

### 1.10 Quality and format issues (★★)

- **Providers:** Google (Storage Saver), Amazon, Windows/HEIC.
- **What happened:**
  - Google's compressed "high quality" mode was warned against by Google itself (TechRadar).
  - Amazon: "no longer recognizing my canon raw files". Old photos sometimes "don't show the correct date."
  - HEIC/HEIF files can't be viewed on Windows without an extra codec (adamfowlerit).
- **FaLe answer:**
  - **Originals only**, bit-exact, with no recompression ever.
  - Thumbnails and previews are generated on the client (HEIC, RAW embedded JPEG, video poster).
  - "Download as JPG" is an option for sharing, and the original is always kept.
  - Respect the EXIF date first, then the file date. Provide a bulk "fix date" tool.

### 1.11 Family-sharing limits (★★)

- **Providers:** Microsoft, Apple, Google.
- **What happened:**
  - Microsoft 365 Family went from 6 × 1 TB to a 2 TB shared pool.
  - iCloud Shared Library allows 6 people, membership in **only one** library, and storage taken from the host. Any participant can delete.
- **What users love:** Ente: "It even has Family Plans". Members get private spaces and the admin can set per-member caps (Ente FAQ).
- **FaLe answer:**
  - The Family plan (up to 6) has private spaces by default, plus any number of shared albums or "shared libraries".
  - The admin can set per-member caps.
  - Only the owner of a photo can delete it. Others can only remove it from the shared album.

### 1.12 Performance, platform gaps and old OS support (★★)

- **What users say:**
  - Proton Drive "still doesn't have drive for Linux". On Android, files can't be opened directly (privacyguides forum, Trustpilot DE).
  - pCloud "has clearly abandoned support for macOS Mojave and earlier."
  - Amazon Photos is a "major memory hog".
  - Dropbox: "It slows my entire computer down."
  - iCloud has no Android app.
- **FaLe answer:**
  - Phone-first PWA plus a Capacitor app, with the full web app usable on **any** OS, Linux included.
  - A lightweight desktop sync later (rclone-compatible/WebDAV or a CLI).
  - Budgets for memory and battery use.

### 1.13 Billing, refunds and cancellation traps (★★)

- **What users say:**
  - Dropbox: "taken money from my account without any notification of any kind."
  - MEGA "declined my request for a refund."
  - pCloud: "no refund issued after 2 months."
- **FaLe answer:**
  - A renewal reminder 7 days before annual renewals.
  - A 14-day no-questions refund, which is legally required in the EU anyway, so make it a feature.
  - Prorated downgrades and in-app cancel.

### What users LOVE (parity checklist)

1. Automatic background backup with "set and forget". Google Photos is "a LIFESAVER when it comes to phone storage" (review).
2. Free up phone space safely once a photo is backed up.
3. Search by person, place, thing and date. Face grouping. Map view.
4. Memories / "Rediscover" ("an unexpected, beautiful walk down memory lane").
5. Easy sharing of albums, links that work without an account, and collaborators adding photos.
6. Access from any device, on the web.
7. Full-quality originals, RAW included (Amazon Photos with Prime).
8. Version history and trash (Dropbox).
9. Family plans with private spaces (Ente).
10. Trust through open source, E2E encryption and fast, human support. MEGA support "responded at lightening speed".
11. Lifetime plans as a value signal (pCloud). Note that Filen dropped lifetime plans.

---

## 2. Competitor table (Oct 2026)

| Service | Free | Paid tiers (EUR/month unless noted) | E2E | Photo features | Family | Offline | Platforms |
|---|---|---|---|---|---|---|---|
| **Google One / Photos** | 15 GB **shared** with Gmail | 100 GB €1.99; AI Plus 400 GB €4.99; AI Plus 2 TB €9.99; AI Pro 5 TB €21.99. Yearly: €19.99 / 49.99 / 99.99 / 219.99. Intro discounts apply (Internxt blog, Aug 2026) | No | Best-in-class search and faces, memories, editing, Ask Photos (Gemini) | Up to 5 others share | Drive offline files | Android, iOS, Web, Win/Mac (Drive) |
| **Apple iCloud+** | 5 GB | 50 GB €0.99; 200 GB €2.99; 2 TB €9.99; 6 TB €29.99; 12 TB €59.99 (trusted.de, Sep 2025 **(verify)**) | Opt-in (Advanced Data Protection) | Strong on-device search, Shared Library (6 people, one library) | Up to 5 others | Yes on Apple devices | iOS, macOS, Windows, Web. **No Android app** |
| **Microsoft OneDrive / M365** | 5 GB | Basic 100 GB ≈ €2; Personal 1 TB with Office ≈ €99/yr; Family now **2 TB shared** for 6 (Oct 2026). US prices $99.99 / $129.99 per year **(EUR verify)** | No (Personal Vault is not E2E) | Camera upload, face grouping AI (opt-out limited) | Up to 6 people, 2 TB pool | Files On-Demand | Win, Mac, Android, iOS, Web |
| **Dropbox** | 2 GB, **3 devices** | Plus 2 TB $9.99/mo annual or $11.99 monthly; Professional 3 TB $16.58 / $19.99 (USD, Internxt Mar 2026; **EUR verify**) | No | Camera uploads, basic gallery | Family plan (6 users, 2 TB) **(verify)** | Yes | Win, Mac, Linux, Android, iOS, Web |
| **Proton Drive** | 5 GB | Drive Plus 200 GB $4.99; Unlimited 500 GB $12.99; Duo 2 TB $19.99; Family 3 TB $29.99 (6 users). USD monthly; EUR similar **(verify)** | Yes | Photo backup, faster gallery since 2026; no face or semantic search | Family 3 TB, 6 users | Partial | Win, Mac, Android, iOS, Web. **No Linux** |
| **pCloud** | Up to 10 GB (unlock tasks) **(verify)** | Lifetime 500 GB $219, 2 TB $499, 10 TB $1,499 (sale prices). Annual plans exist **(verify)** | Only with paid Crypto add-on | Auto upload, basic gallery | Family lifetime (5 users) | Virtual drive and offline | Win, Mac, Linux, Android, iOS, Web |
| **MEGA** | 20 GB | Pro Lite 400 GB €4.99; Pro I 2 TB €9.99; Pro II 8 TB €19.99; Pro III 16 TB €29.99 (subger **(verify)**). Transfer quotas apply | Yes | Camera uploads, basic gallery | No real family plan | Yes | All, including Linux |
| **Amazon Photos** | 5 GB; **Prime: unlimited full-res photos + 5 GB video** | 100 GB €1.99; 1 TB €9.99; 2 TB €19.99 (GIGA 2022 **(verify)**) | No | Face/object search, Family Vault | Family Vault (Prime household) | Limited | Android, iOS, Web, Win/Mac |
| **Ente Photos** | 10 GB | 50 GB $2.49; 200 GB $4.99; 1 TB $9.99; 2 TB $19.99 per month (USD, single global price) | Yes | **On-device faces and semantic search**, memories, map, shared albums with public links | Family (5 extra members) free on paid plans | Yes | Android, iOS, Web, Win, Mac, Linux. Open source, self-hostable |
| **Filen** (DE) | 10 GiB (deleted after 3 months inactive) | 200 GB €1.99; 500 GB €3.99; 2 TB €8.99; 10 TB €39.99 (yearly €19.99 / 39.99 / 89.99 / 399.99). No more lifetime plans | Yes | Camera upload, basic gallery | No | Yes | All, including Linux |
| **Self-hosted** (Synology Photos / Nextcloud / Immich) | Hardware cost | NAS plus disks (one-off) | Not E2E (server holds keys) | Immich close to Google Photos. Nextcloud basic, Memories app helps | Multi-user | LAN | Apps on all. Reliability depends on the admin |

**Price anchors for FaLe:**
- The EU/E2E price floor is **Filen**: 200 GB €1.99, 2 TB €8.99.
- The mainstream anchor is **€9.99 for 2 TB** (Google and Apple).
- Ente and Proton charge about 2× that for E2E and photo intelligence.

---

## 3. EU storage backends and real costs

### 3.1 Providers (excluding VAT)

| Provider | Storage per TB-month | Egress | Requests | S3 | Location and jurisdiction | Gotchas |
|---|---|---|---|---|---|---|
| **Supabase Storage** (Pro $25 per month) | 100 GB included, then $0.0213/GB ≈ **€18.3/TB** | 250 GB uncached included, then $0.09/GB (cached $0.03/GB) | Included | Yes (S3 protocol endpoint) | eu-central-1 Frankfurt. Runs on AWS S3, a US company (CLOUD Act) | 2.8× Hetzner per TB. Egress gets expensive for galleries. Image transforms $5 per 1,000 origin images |
| **Hetzner Object Storage** | €6.49 base includes 1 TB storage and 1 TB egress. Extra ≈ **€6.47/TB** (€0.0087 per TB-hour) since 1 Apr 2026. One source quotes €8.70 per TB **(verify)** | 1 TB included, then **€1 per TB** | **Free** | Yes ("not ideal for every S3 use case") | FSN1 / NBG1 (DE), HEL1 (FI). German company | Objects under 64 KB are billed as 64 KB, so pack thumbnails. Max 100 TB and 50 M objects per bucket, 100 buckets. Single site |
| **OVHcloud** | 1-AZ $0.0081/GiB ≈ **€6.5/TB**; 3-AZ ≈ **€12.6/TB**; Cold Archive ≈ €2/TB (180-day minimum) | **Free** | **Free** | Yes | FR/DE/PL and more. French company (SecNumCloud options) | USD list prices. Cold Archive retrieval fees |
| **IONOS Object Storage** | €0.007/GB per 30 days ≈ **€7/TB** | First 2 TB per month free per contract, then €0.03/GB (falling to €0.015) | Free | Yes | DE (Frankfurt, Berlin), ES. German company | Egress pool shared across all IONOS cloud services in the contract |
| **Scaleway** | Multi-AZ **€16/TB**; One Zone **€8/TB**; Glacier **€2.5/TB** | 75 GB per month free, then €0.01/GB | Included | Yes | PAR / AMS / WAW. French company | Glacier restore costs €0.009/GB. Good for a second cold copy |
| **Backblaze B2** | **$6.95/TB ≈ €6.0** (first 10 GB free) | Free up to 3× stored, then $0.01/GB | Mostly free (Class D $0.004 per 10k) | Yes | EU Central = Amsterdam. US company (CLOUD Act) | US jurisdiction. Fine for ciphertext only |
| **Wasabi** | **$7.99/TB ≈ €6.9** | Free if ≤ stored volume (fair use) | Free | Yes | EU regions (Amsterdam, Frankfurt, London, Paris) **(verify)**. US company | **1 TB minimum charge** and **90-day minimum retention**. Bad for small or early use and for frequent deletes |
| **Cloudflare R2** (EU jurisdiction bucket) | **$15/TB ≈ €12.9** (10 GB free) | **Free** | Class A $4.50/M, Class B $0.36/M | Yes | EU jurisdiction guarantees EU storage. US company | 2× the cost of Hetzner/OVH for storage-heavy workloads. Only wins when egress is heavy |

### 3.2 Cost per user per month (storage only, +5 % overhead for thumbnails and encryption headers; EUR; est.)

Assumptions **(est.)**:
- Free users average 40 % fill, with "full" shown as the worst case.
- Paid users average 40 % fill.
- Monthly egress is about 10 % of stored data (thumbnails plus occasional downloads).

| Provider | Free 5 GB (avg / full) | Free 10 GB (avg / full) | 200 GB (80 GB) | 1 TB (400 GB) | 2 TB (800 GB) |
|---|---|---|---|---|---|
| Supabase (beyond the included 100 GB) | 0.04 / 0.10 | 0.08 / 0.19 | 1.54 | 7.69 | 15.39 |
| **Hetzner** | **0.01 / 0.03** | **0.03 / 0.07** | **0.54** | **2.72** | **5.44** |
| OVH 1-AZ | 0.01 / 0.03 | 0.03 / 0.07 | 0.55 | 2.73 | 5.46 |
| IONOS | 0.02 / 0.04 | 0.03 / 0.07 | 0.59 | 2.94 | 5.88 |
| Backblaze B2 (EU) | 0.01 / 0.03 | 0.03 / 0.06 | 0.50 | 2.51 | 5.02 |
| Wasabi (ignoring the 1 TB minimum) | 0.01 / 0.04 | 0.03 / 0.07 | 0.58 | 2.89 | 5.77 |
| Scaleway One Zone | 0.02 / 0.04 | 0.03 / 0.08 | 0.68 | 3.37 | 6.75 |
| Cloudflare R2 | 0.03 / 0.07 | 0.05 / 0.14 | 1.08 | 5.42 | 10.84 |
| Scaleway Multi-AZ | 0.03 / 0.08 | 0.07 / 0.17 | 1.35 | 6.75 | 13.49 |

Egress at 10 % per month:
- Hetzner: under €0.10 even for 2 TB users. OVH, B2, Wasabi and R2: €0.
- Supabase uncached egress adds €0.62 / €3.10 / €6.19 for the 200 GB / 1 TB / 2 TB users.

**Optional second copy for durability** (Scaleway Glacier at €2.54/TB) adds €0.21 / €1.07 / €2.13 for the 200 GB / 1 TB / 2 TB users.

### 3.3 Revenue after VAT and payment fees (per month, B2C Germany at 19 % VAT)

How the fees are applied:
- **Play Billing (EEA subscriptions):** 10 % plus a 5 % billing fee = 15 %, charged on the price net of VAT. Google handles the VAT.
- **Stripe:** 1.5 % + €0.25 (EEA cards) plus 0.7 % for Stripe Billing.

| List price | Net of VAT | Stripe monthly | Stripe annual (per month) | Play |
|---|---|---|---|---|
| €1.99 | 1.67 | 1.38 | 1.61 | 1.42 |
| €4.99 | 4.19 | 3.83 | 4.06 | 3.56 |
| €5.99 | 5.03 | 4.65 | 4.88 | 4.28 |
| €8.99 | 7.56 | 7.11 | 7.34 | 6.42 |
| €9.99 | 8.40 | 7.93 | 8.15 | 7.14 |

### 3.4 Gross margin on Hetzner (40 % fill, plus €0.10 per user per month for DB, Auth and support **(est.)**)

| Plan | Stripe monthly | Stripe annual | Play | If the user fills 100 % (Stripe monthly) |
|---|---|---|---|---|
| 200 GB @ €1.99 | €0.74 (53 %) | €0.96 (60 %) | €0.78 (55 %) | ≈ €0 (break-even) |
| 1 TB @ €4.99 | €1.02 (27 %) | €1.25 (31 %) | €0.75 (21 %) | **−€3.06** |
| 1 TB @ €5.99 | €1.83 (39 %) | €2.06 (42 %) | €1.46 (34 %) | −€2.24 |
| 2 TB @ €8.99 | €1.57 (22 %) | €1.80 (25 %) | €0.89 (14 %) | **−€6.58** |
| 2 TB @ €9.99 | €2.39 (30 %) | €2.62 (32 %) | €1.60 (22 %) | −€5.76 |

**Cross-subsidy for free users (est.):**
- With 5 % conversion there are 19 free users per paying user.
- At 10 GB free, the average free user costs about €0.03–0.04 per month, so roughly €0.6–0.8 of each paying user's margin.
- In the worst case (every free user full) it is about €1.3.
- At 2 % conversion (49 free users per paying user) it is about €1.5–3.3. **The free tier is the biggest margin risk, more than the TB tiers.**
- On Supabase Storage, the same free tier costs about 2.8× as much.

**VAT note (brief; check with a tax advisor):**
- B2C digital services are taxed at the **customer's country rate**. Use OSS registration, or Stripe Tax.
- Play Store sales: Google is the merchant of record and remits VAT.
- The German §19 Kleinunternehmer exemption does not remove OSS duties for EU customers above the €10k EU-wide threshold.
- The alternative is a merchant of record (Paddle / Lemon Squeezy, ~5 % + €0.50). It is simpler but costs more.
- Android: selling storage inside the Play app requires Play Billing, or Google's EEA alternative-billing / external-offers programmes (reduced fee). Buying on the web PWA via Stripe avoids the 15 %. **(verify the current DMA programme terms)**

---

## 4. Recommendation

### Backend

- **Now (beta, until about 100 GB in total):**
  - Keep everything in Supabase: Postgres metadata, Auth, RLS quotas, and Storage via its **S3-compatible endpoint**. It is already paid for and 100 GB plus 250 GB egress are included.
  - Code against a thin S3 adapter: presigned PUT/GET, multipart, with chunked ciphertext.
- **At public launch / when paid tiers go live:**
  - Move the blobs to **Hetzner Object Storage**, bucket in FSN1/NBG1.
  - Vercel or Supabase Edge functions only sign URLs. Clients upload and download ciphertext directly.
  - No servers to run. A German company, GDPR-simple, and about €6.5 per TB with near-free egress and free requests.
  - Pack thumbnails into bundles of 64 KB or more, or keep small thumbnails in Postgres/Supabase, to avoid the 64 KB minimum-object billing.
  - **Fallback with an identical cost profile:** OVH 1-AZ, or IONOS (2 TB of free egress).
- **Later (more than about 10 TB stored, or before selling "never lose a photo"):**
  - Add an async **second copy at a different EU company** (Scaleway Glacier €2.5/TB or OVH Cold Archive ~€2/TB) for disaster recovery. Ente's 3-provider replication is the benchmark.
  - Above 100–200 TB, evaluate Hetzner dedicated servers with your own S3 (Garage/Ceph) or committed-capacity deals.
- **Avoid for the bulk data:** Wasabi (1 TB minimum and 90-day retention), R2 and Scaleway Multi-AZ (2× the cost), and Supabase Storage at TB scale (2.8× the cost plus egress).

### Free tier

**10 GB**, for Drive and Fotos combined, never shared with mail.
- It matches the privacy challengers (Ente and Filen at 10 GB), is 2× iCloud, Proton and OneDrive, and is 5× Dropbox.
- On Hetzner it costs at most about €0.07 per user per month.
- Guardrails:
  - No silent deletion. Inactive for 12 months means a freeze, never a delete, and only after multiple notices.
  - Fair-use limits on upload rate.
  - If conversion falls below about 2 %, cap new free accounts at 5 GB plus referral bonuses.

### Pricing (prices include VAT)

| Plan | Monthly | Yearly | Notes |
|---|---|---|---|
| Free | 0 | 0 | 10 GB, all core features (on-device search, sharing, export) |
| Plus 200 GB | **€1.99** | **€19.90** | Matches Filen. Healthy margin of 53–60 % |
| Pro 1 TB | **€5.49–5.99** | **€54–59** | €4.99 is only viable on annual billing at average fill |
| Max 2 TB, Family up to 6 included | **€9.99** | **€99** | Same price as Google and Apple, but E2E, EU and family included. Direct answer to the M365 cut |

- Offer an **introductory price-lock guarantee** ("your price never changes while subscribed").
- Nudge users to annual and web billing. Do **not** offer lifetime plans until the cost curve is known.

### Top 10 product principles (from the complaints)

1. **Your photos never hold your other apps hostage.** A separate quota, and over-quota means read-only, never deletion.
2. **Visible, provable backup.** A "last backed up" status, and an alert if backup stalls for more than 3 days. Silent failure is the enemy.
3. **Deleting is explicit.** "Remove from phone" and "Delete everywhere" are separate actions, backed by trash, versions and an undo.
4. **Originals, untouched.** No recompression. EXIF and dates preserved. HEIC and RAW previews on the device.
5. **Private by architecture.** E2E by default, AI and faces on the device, opt-in for every content feature, no training, no scanning-based bans.
6. **Leave anytime, in one click.** A full export with metadata, Takeout import, cancel in 2 clicks. Low lock-in is the trust signal.
7. **Honest pricing.** No bait intros, a price-lock promise, no retroactive cuts, renewal reminders, the 14-day refund.
8. **Calm UI.** One timeline, one search box, no upsell banners, no feeds. Notifications are only about your backup.
9. **Recoverable accounts plus humans.** A recovery kit, a trusted or legacy contact, and a real support inbox with an SLA.
10. **Family without fine print.** Private spaces by default, shared albums or libraries without limits, owner-only delete, admin quotas.

---

## Sources

Complaints, reviews and press:
- https://techradar.com/computing/cloud-computing/microsoft-365-family-plans-cloud-storage-has-been-cut-right-down-and-theres-a-lot-of-threatened-cancellations
- https://www.androidauthority.com/microsoft-365-onedrive-storage-2tb-3721492/
- https://pureinfotech.com/microsoft-365-personal-family-price-increase/
- https://www.androidauthority.com/google-low-storage-notifications-3522121/
- https://dev.to/tiltedlunar123/your-gmail-is-not-full-your-google-account-is-1k7c
- https://techcrunch.com/2026/03/10/google-gives-in-to-users-complaints-over-ai-powered-ask-photos-search-feature/
- https://reclaimthenet.org/microsoft-onedrive-facial-recognition-photo-sorting-feature
- https://www.neowin.net/news/windows-11-is-now-automatically-enabling-onedrive-folder-backup-without-asking-permission/
- https://petapixel.com/2022/08/22/google-flags-photos-of-fathers-sick-son-as-child-abuse-informs-police
- https://lauren.vortex.com/?p=5018
- https://laptopmag.com/how-to/how-to-delete-images-from-google-photos-without-deleting-them-on-your-phone
- https://justuseapp.com/en/app/962194608/google-fotos/reviews
- https://justuseapp.com/en/app/621574163/amazon-photos/reviews
- https://www.capterra.co.uk/software/1030992/google-photos
- https://www.trustpilot.com/review/dropbox.com
- https://www.trustpilot.com/review/icloud.com
- https://www.trustpilot.com/review/pcloud.com?page=3
- https://www.trustpilot.com/review/mega.nz?page=8
- https://ch.trustpilot.com/review/proton.me/drive
- https://discuss.privacyguides.net/t/proton-proton-drive-got-faster-and-easier-to-use-in-early-2026/37146
- https://pol1.lr.ggtyler.dev/r/iCloud/comments/1hl1fgd/extremely_slow_icloud_backup (r/iCloud mirror)
- https://shop.zimaspace.com/blogs/support-tips/why-phone-photo-backup-stops-in-background
- https://www.phonearena.com/news/Google-Photos-no-longer-supports-the-option-to-backup-only-while-charging_id95271
- https://venturebeat.com/business/dropbox-now-limits-free-users-to-3-devices
- https://melbits.com.au/kb/why-does-onedrive-keep-duplicating-files
- https://www.macrumors.com/guide/icloud-shared-photo-library
- https://www.ubergizmo.com/2019/07/google-photos-private-links-not-private/
- https://community.ente.io/blog/google-takeout
- https://pixelunion.eu/blog/how-to-keep-metadata-when-exporting-google-photos/
- https://www.techradar.com/news/google-photos-warns-against-using-its-compressed-high-quality-mode-heres-why
- https://adamfowlerit.com/2020/02/heic-and-heif-files-cant-be-viewed-on-widows-10/
- https://lemmy.amethyst.name/post/574285 (self-hosters: Immich / Nextcloud)
- https://alternativeto.net/software/ente/about

Competitor pricing:
- https://blog.internxt.com/de/google-one-preise-alle-tarife-stufen-und-eine-private-alternative/
- https://support.google.com/googleone/answer/17251824?hl=en
- https://trusted.de/apple-icloud-kosten
- https://blog.internxt.com/dropbox-pricing/
- https://proton.me/drive/pricing
- https://www.pcloud.com/cloud-storage-pricing-plans.html
- https://subger.com/en/service/mega
- https://www.giga.de/artikel/amazon-photos-kosten-fuer-den-cloud-speicher/
- https://ente.com/de/
- https://ente.com/help/photos/faq/storage-and-plans
- https://blog.internxt.com/filen-pricing/

Storage backends and fees:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/storage/pricing
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://www.hetzner.com/storage/object-storage/
- https://agentdeals.dev/hetzner-pricing-2026
- https://sliplane.io/blog/cheap-object-storage-providers-europe
- https://www.ovhcloud.com/en/public-cloud/prices/
- https://docs.ionos.com/support/general-information/price-list/ionos-cloud-eur-en
- https://docs.ionos.com/cloud/backup-and-storage/ionos-object-storage/overview/pricing.md
- https://www.scaleway.com/en/pricing/storage/
- https://www.backblaze.com/cloud-storage/pricing
- https://www.backblaze.com/blog/announcing-our-first-european-data-center/
- https://wasabi.com/pricing
- https://wasabi.com/pricing/faq
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/reference/data-location/
- https://stripe.com/de/pricing
- https://support.google.com/googleplay/android-developer/answer/112622?hl=en
