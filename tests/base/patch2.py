import os
p=os.environ["S"]+"/sim.sh"; s=open(p).read()
a=s.index('DOMAIN_ID=$(stalwart-cli'); b=s.index('echo "== gitops #1"')
new='''printf 'KONTO_PASSWORD=SimKonto0123456789xyz\\n' >> $R/etc-fale/owner-secrets.env
sed -n '/^# Mailboxes/,/^create_mailbox konto/p' /home/claude/FalePDF/mail/server/firstboot.sh | sed "s#/etc/fale-mail#$R/etc-fale#g" > $R/mb.sh
MAIL_DOMAIN=fale.network bash -e $R/mb.sh && echo "MAILBOXES ok"; MAIL_DOMAIN=fale.network bash -e $R/mb.sh && echo "MAILBOXES idempotent"
stalwart-cli query Account 2>&1 | grep -E 'postmaster|konto'
'''
s=s[:a]+new+s[b:]
s=s.replace("p.resticPassword==='SimResticPass'?'restic-ok':'restic-bad');", "p.resticPassword==='SimResticPass'?'restic-ok':'restic-bad', p.transactional.password==='SimKonto0123456789xyz'?'konto-ok':'konto-bad');")
open(p,"w").write(s)
