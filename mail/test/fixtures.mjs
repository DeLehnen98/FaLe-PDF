// Shared test fixture: a status.json as published by mail/server/fale-mail-agent.py (documentation IPs).
export const STATUS = {
  schema: 'fale-mail-status/1', generatedAt: new Date().toISOString(), host: 'mail.fale.network', domain: 'fale.network',
  ipv4: '203.0.113.25', ipv6: '2001:db8::25',
  dkim: [
    { selector: 'v1-ed25519-20261016', algorithm: 'ed25519', value: 'v=DKIM1; k=ed25519; h=sha256; p=yCWQoVfvNWwOPTmAEeTLBtvk7ULYRS4WsLUdweL0nv0=' },
    { selector: 'v1-rsa-20261016', algorithm: 'rsa', value: 'v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxPD7EH4yKuySMopq7IHZA88dkQ6W6' },
  ],
};
