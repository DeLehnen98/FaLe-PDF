#!/bin/bash
if [ "$APPLY" != "true" ]; then echo "DNS-Abgleich nicht angefordert."; exit 0; fi
if [ -z "$VERCEL_TOKEN" ]; then echo "::warning title=FaLe Mail::DNS-Abgleich angefordert, aber Secret VERCEL_TOKEN fehlt."; exit 0; fi
ARGS=(--apply --prune --dmarc "$MAIL_DMARC" --mta-sts "$MAIL_MTA_STS")
if ! getent hosts mail.fale.network >/dev/null; then
  if [ -z "$MAIL_SERVER_IP" ]; then echo "::notice title=FaLe Mail::Noch kein Server – kein DNS-Abgleich."; exit 0; fi
  ARGS+=(--status-url "https://$MAIL_SERVER_IP/fale/status.json" --insecure)
fi
node scripts/mail-dns.mjs "${ARGS[@]}"

