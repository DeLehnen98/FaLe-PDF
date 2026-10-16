"""python3 -m unittest discover -s mail/test  – unit tests for mail/server/fale-mail-agent.py (no root, no server)."""
import importlib.util, json, os, pathlib, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("agent", HERE.parent / "server" / "fale-mail-agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

ZONE = '''v1-ed25519-20261016._domainkey.fale.network. IN TXT "v=DKIM1; k=ed25519; h=sha256; p=yCWQoVfvNWwOPTmAEeTLBtvk7ULYRS4WsLUdweL0nv0="
v1-rsa-20261016._domainkey.fale.network. IN TXT (
    "v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxPD7"
    "rrGvAojicWgalCnlqWHOvbwsKcQiaB1nYMVB+uGdsqalkPS7cl+A0jBDijAkZllLG0jdQFN7A"
)
fale.network. IN MX 10 mail.fale.network.
'''


class Plan(unittest.TestCase):
    def test_repo_plan_is_valid(self):
        ops = agent.validate_plan((HERE.parent / "config" / "stalwart.ndjson").read_text())
        self.assertGreater(len(ops), 10)

    def test_rejects_forbidden(self):
        for line, why in [
            ('{"@type":"upsert","object":"Account","value":{"a":{"name":"x"}}}', "allowlist"),
            ('{"@type":"create","object":"Domain","value":{"a":{"name":"x"}}}', "not allowed"),
            ('{"@type":"upsert","object":"Domain","value":{"a":{"name":"x","allowRelaying":true}}}', "relaying"),
            ('{"@type":"upsert","object":"AcmeProvider","value":{"a":{"eabHmacKey":"abc"}}}', "secret-looking"),
            ('{"@type":"upsert","object":"Application","value":{"a":{"resourceUrl":"https://evil.example/x.zip"}}}', "resourceUrl"),
        ]:
            with self.assertRaisesRegex(ValueError, why):
                agent.validate_plan(line)


class Manifest(unittest.TestCase):
    def test_repo_manifest_matches(self):
        agent.verify_manifest(str(HERE.parent))

    def test_detects_changes(self):
        with tempfile.TemporaryDirectory() as d:
            m = pathlib.Path(d)
            (m / "config").mkdir(); (m / "web").mkdir(); (m / "config" / "pairing").mkdir()
            (m / "config" / "a.ndjson").write_text("x\n")
            (m / "web" / "index.html").write_text("<p>")
            (m / "config" / "pairing" / "owner.json").write_text("{}")  # excluded from the manifest
            lines = [f"{agent.sha256_file(m / p)}  {p}" for p in ("config/a.ndjson", "web/index.html")]
            (m / "config" / "MANIFEST.sha256").write_text("\n".join(lines) + "\n")
            agent.verify_manifest(d)
            (m / "config" / "a.ndjson").write_text("y\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                agent.verify_manifest(d)
            (m / "config" / "a.ndjson").write_text("x\n")
            (m / "web" / "extra.js").write_text("")
            with self.assertRaisesRegex(ValueError, "unlisted"):
                agent.verify_manifest(d)


class Status(unittest.TestCase):
    def test_parse_zone_dkim(self):
        dk = agent.parse_zone_dkim(ZONE)
        self.assertEqual([d["selector"] for d in dk], ["v1-ed25519-20261016", "v1-rsa-20261016"])
        self.assertEqual(dk[1]["algorithm"], "rsa")
        self.assertTrue(dk[1]["value"].endswith("LG0jdQFN7A"))
        self.assertNotIn('"', dk[1]["value"])

    def test_assert_public(self):
        agent.assert_public({"sealPublicKey": {"jwk": {"x": "1"}}, "dkim": [{"value": "v=DKIM1"}]})
        for bad in ({"adminPassword": "x"}, {"a": {"token": "t"}}, {"z": "-----BEGIN " + "PRIVATE KEY-----"}):
            with self.assertRaises(ValueError):
                agent.assert_public(bad)

    def test_semver(self):
        self.assertLess(agent.semver("0.16.25"), agent.semver("0.17.0"))
        self.assertLess(agent.semver("0.9.9"), agent.semver("0.16.0"))


class Sealed(unittest.TestCase):
    def test_backup_secret_and_pairing(self):
        with tempfile.TemporaryDirectory() as d:
            etc, mail = pathlib.Path(d, "etc"), pathlib.Path(d, "mail")
            etc.mkdir()
            (mail / "config" / "sealed").mkdir(parents=True)
            (mail / "config" / "pairing").mkdir(parents=True)
            old = agent.ETC
            agent.ETC = str(etc)
            try:
                agent.cmd_keygen()
                self.assertEqual(oct(os.stat(etc / "seal-key.pem").st_mode & 0o777), "0o600")
                server_jwk = agent.jwk_from_public(agent.load_seal_key().public_key())
                payload = {"name": "backup", "env": {"RESTIC_REPOSITORY": "s3:https://h/b", "AWS_ACCESS_KEY_ID": "k",
                                                      "AWS_SECRET_ACCESS_KEY": "s", "EVIL": "x"}}
                (mail / "config" / "sealed" / "backup.json").write_text(json.dumps(agent.seal(server_jwk, json.dumps(payload).encode())))
                (mail / "config" / "sealed" / "Bad Name.json").write_text("{}")
                state = {}
                agent.process_sealed(str(mail), state)
                self.assertTrue(state["sealed"]["backup"]["ok"])
                env = (etc / "backup.env").read_text()
                self.assertIn("AWS_SECRET_ACCESS_KEY=s", env)
                self.assertNotIn("EVIL", env)
                # pairing: owner key -> sealed bundle that only that key opens
                from cryptography.hazmat.primitives.asymmetric import ec
                phone = ec.generate_private_key(ec.SECP256R1())
                (mail / "config" / "pairing" / "owner.json").write_text(json.dumps({"role": "owner", "jwk": agent.jwk_from_public(phone.public_key())}))
                (mail / "config" / "pairing" / "broken.json").write_text('{"role":"owner","jwk":{"kty":"RSA"}}')
                (etc / "agent.env").write_text("STALWART_USER=admin\nSTALWART_PASSWORD=pw123\n")
                out = pathlib.Path(d, "out")
                self.assertEqual(agent.build_pairing(str(mail), str(out)), ["owner"])
                bundle = json.loads(agent.unseal(phone, json.loads((out / "owner.json").read_text())))
                self.assertEqual(bundle["admin"]["password"], "pw123")
            finally:
                agent.ETC = old


if __name__ == "__main__":
    unittest.main()
