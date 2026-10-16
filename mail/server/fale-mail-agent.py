#!/usr/bin/env python3
"""FaLe Mail server agent (runs as root on the mail server, installed by mail/cloud-init.yaml).

Subcommands
  keygen   create the server's sealing key (P-256) if missing
  gitops   pull mail/config + mail/web from the public repo (main only), verify, apply to Stalwart
  status   collect public, non-sensitive health data and publish https://<host>/fale/status.json
  backup   encrypted restic backup to S3 (only once the owner has provided sealed credentials)

Trust model (see docs/FALE-MAIL.md): secrets are generated here and never leave the box unencrypted.
The repo can change configuration, but only object types on ALLOWED_OBJECTS, only from branch main,
only fast-forward, only when every file matches mail/config/MANIFEST.sha256 and - if
/etc/fale-mail/allowed_signers is non-empty - only signed commits.
"""
import base64, hashlib, json, os, re, shutil, socket, ssl, subprocess, sys, tarfile, tempfile, time
import urllib.request, zipfile
from datetime import datetime, timezone

AGENT_VERSION = "1"
SEAL_VERSION = "fale-seal-1"
ENV = os.environ
ETC = ENV.get("FALE_MAIL_ETC", "/etc/fale-mail")
VAR = ENV.get("FALE_MAIL_VAR", "/var/lib/fale-mail")
REPO_URL = ENV.get("FALE_MAIL_REPO", "https://github.com/DeLehnen98/FaLe-PDF.git")
BRANCH = "main"
CLI = ENV.get("FALE_MAIL_CLI", "/usr/local/bin/stalwart-cli")
SERVER_BIN = ENV.get("FALE_MAIL_SERVER_BIN", "/usr/local/bin/stalwart")
MAIL_HOST = ENV.get("FALE_MAIL_HOST", "mail.fale.network")
MAIL_DOMAIN = ENV.get("FALE_MAIL_DOMAIN", "fale.network")
RELEASE_PREFIXES = ("https://github.com/stalwartlabs/stalwart/releases/download/",
                    "https://github.com/stalwartlabs/cli/releases/download/")
ALLOWED_OBJECTS = {
    "AcmeProvider", "Domain", "SystemSettings", "NetworkListener", "Http", "Email", "Imap", "Jmap",
    "MtaOutboundThrottle", "MtaInboundThrottle", "MtaQueueQuota", "MtaInboundSession", "MtaExtensions",
    "MtaDeliverySchedule", "MtaTlsStrategy", "MtaSts", "MtaStageConnect", "MtaStageEhlo", "MtaStageMail",
    "MtaStageRcpt", "MtaStageData", "MtaStageAuth", "SpamSettings", "SpamDnsblSettings", "SpamDnsblServer",
    "SpamRule", "SpamTag", "SpamFileExtension", "BlockedIp", "AllowedIp", "DmarcReportSettings",
    "DkimReportSettings", "SpfReportSettings", "TlsReportSettings", "ReportSettings", "DsnReportSettings",
    "DataRetention", "Cache", "Security", "Application", "DnsResolver",
}
ALLOWED_OPS = {"upsert", "update", "destroy"}
SECRET_KEYS = re.compile(r"(secret|password|accountKey|eabHmacKey|privateKey|token)", re.I)
BACKUP_ENV_KEYS = {"RESTIC_REPOSITORY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION"}
DNSBL = ["zen.spamhaus.org", "b.barracudacentral.org", "bl.spamcop.net", "psbl.surriel.com"]


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def read_text(path, mode="r"):
    with open(path, mode) as f:
        return f.read()


def read_json(path):
    return json.loads(read_text(path))


def read_env_file(path):
    out = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip().strip('"')
    except FileNotFoundError:
        pass
    return out


def write_private(path, data, mode=0o600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "wb" if isinstance(data, bytes) else "w") as f:
        f.write(data)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def load_state():
    try:
        with open(os.path.join(VAR, "state.json")) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def save_state(state):
    write_private(os.path.join(VAR, "state.json"), json.dumps(state, indent=1, sort_keys=True), 0o600)


def log(msg):
    print(f"[fale-mail] {msg}", flush=True)


# ---------------------------------------------------------------- sealing (ECDH P-256 + HKDF-SHA256 + AES-256-GCM)
# Same format as mail/tools/seal.mjs and mail/web/index.html (WebCrypto). Ciphertext may be public.
def _crypto():
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return ec, hashes, serialization, HKDF, AESGCM


def jwk_from_public(pub):
    nums = pub.public_numbers()
    return {"kty": "EC", "crv": "P-256", "x": b64u(nums.x.to_bytes(32, "big")), "y": b64u(nums.y.to_bytes(32, "big"))}


def public_from_jwk(jwk):
    ec, *_ = _crypto()
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise ValueError("only EC P-256 keys are supported")
    x, y = int.from_bytes(unb64u(jwk["x"]), "big"), int.from_bytes(unb64u(jwk["y"]), "big")
    return ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()


def kid_of(jwk):
    raw = b"\x04" + unb64u(jwk["x"]) + unb64u(jwk["y"])
    return b64u(hashlib.sha256(raw).digest())[:16]


def _derive(shared, kid):
    _, hashes, _, HKDF, _ = _crypto()
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32),
                info=(SEAL_VERSION + "|" + kid).encode()).derive(shared)


def seal(recipient_jwk, plaintext: bytes):
    ec, _, _, _, AESGCM = _crypto()
    kid = kid_of(recipient_jwk)
    eph = ec.generate_private_key(ec.SECP256R1())
    key = _derive(eph.exchange(ec.ECDH(), public_from_jwk(recipient_jwk)), kid)
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, plaintext, kid.encode())
    return {"v": SEAL_VERSION, "kid": kid, "epk": jwk_from_public(eph.public_key()), "iv": b64u(iv), "ct": b64u(ct)}


def unseal(private_key, box):
    ec, _, _, _, AESGCM = _crypto()
    if box.get("v") != SEAL_VERSION:
        raise ValueError("unknown seal version")
    kid = kid_of(jwk_from_public(private_key.public_key()))
    if box.get("kid") != kid:
        raise ValueError("sealed for a different key (kid mismatch)")
    key = _derive(private_key.exchange(ec.ECDH(), public_from_jwk(box["epk"])), kid)
    return AESGCM(key).decrypt(unb64u(box["iv"]), unb64u(box["ct"]), kid.encode())


def seal_key_path():
    return os.path.join(ETC, "seal-key.pem")


def load_seal_key():
    _, _, serialization, _, _ = _crypto()
    with open(seal_key_path(), "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def cmd_keygen():
    if os.path.exists(seal_key_path()):
        return
    ec, _, serialization, _, _ = _crypto()
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    write_private(seal_key_path(), pem, 0o600)
    log("seal key generated")


# ---------------------------------------------------------------- stalwart-cli wrapper
def cli_env():
    env = dict(os.environ)
    env.update(read_env_file(os.path.join(ETC, "agent.env")))
    env.setdefault("STALWART_URL", "http://127.0.0.1:8080")
    env["NO_PROXY"] = "127.0.0.1,localhost"
    return env


def cli(*args, check=True, timeout=120):
    r = subprocess.run([CLI, "--no-color", *args], env=cli_env(), capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"stalwart-cli {args[0]} failed: {(r.stderr or r.stdout).strip()[-800:]}")
    return r


def ndjson(text):
    return [json.loads(l) for l in text.splitlines() if l.strip().startswith("{")]


# ---------------------------------------------------------------- GitOps
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_manifest(mail_dir):
    """MANIFEST.sha256 lists every file under mail/config and mail/web (paths relative to mail/), except
    config/pairing/ and config/sealed/: those are added from a phone via GitHub, are self-describing and are
    schema-checked instead (a hash list adds no authority there - whoever can push can also edit the list)."""
    man = os.path.join(mail_dir, "config", "MANIFEST.sha256")
    listed = {}
    with open(man) as f:
        for line in f:
            if line.strip():
                digest, rel = line.split(None, 1)
                listed[rel.strip()] = digest
    present = set()
    for sub in ("config", "web"):
        for root, dirs, files in os.walk(os.path.join(mail_dir, sub)):
            if sub == "config":
                dirs[:] = [d for d in dirs if d not in ("pairing", "sealed")]
            for name in files:
                rel = os.path.relpath(os.path.join(root, name), mail_dir)
                if rel != "config/MANIFEST.sha256":
                    present.add(rel)
    if present != set(listed):
        raise ValueError(f"manifest mismatch: unlisted={sorted(present - set(listed))} missing={sorted(set(listed) - present)}")
    for rel, digest in listed.items():
        if sha256_file(os.path.join(mail_dir, rel)) != digest:
            raise ValueError(f"hash mismatch: {rel}")
    return hashlib.sha256(read_text(man, "rb")).hexdigest()


def validate_plan(text):
    ops = []
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        op = json.loads(line)
        if op.get("@type") not in ALLOWED_OPS:
            raise ValueError(f"line {n}: operation {op.get('@type')!r} not allowed")
        if op.get("object") not in ALLOWED_OBJECTS:
            raise ValueError(f"line {n}: object {op.get('object')!r} not on the allowlist")
        blob = json.dumps(op)
        if re.search(r'"allowRelaying":\s*true', blob):
            raise ValueError(f"line {n}: open relaying is never allowed via GitOps")
        if op["object"] == "Application":
            for v in (op.get("value") or {}).values():
                url = v.get("resourceUrl", "") if isinstance(v, dict) else ""
                if url and not (url.startswith("file:///var/lib/fale-mail/") or url.startswith("https://github.com/stalwartlabs/")):
                    raise ValueError(f"line {n}: Application resourceUrl not allowed: {url}")
        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if SECRET_KEYS.search(k) and v not in (None, "", {}):
                        raise ValueError(f"line {n}: secret-looking field {k!r} must not come from the public repo")
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(op.get("value"))
        ops.append(op)
    return ops


def git(*args, cwd=None, check=True):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=300)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed: {r.stderr.strip()[-500:]}")
    return r.stdout.strip()


def sync_repo(state):
    repo = os.path.join(VAR, "repo")
    if not os.path.isdir(os.path.join(repo, ".git")):
        shutil.rmtree(repo, ignore_errors=True)
        git("clone", "--quiet", "--filter=blob:none", "--no-checkout", "--single-branch", "--branch", BRANCH, REPO_URL, repo)
        git("sparse-checkout", "set", "--no-cone", "/mail/config/", "/mail/web/", cwd=repo)
    else:
        git("fetch", "--quiet", "origin", f"+refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}", cwd=repo)
    head = git("rev-parse", f"refs/remotes/origin/{BRANCH}", cwd=repo)
    last = state.get("gitops", {}).get("commit")
    if last and last != head and subprocess.run(["git", "merge-base", "--is-ancestor", last, head], cwd=repo).returncode != 0:
        raise RuntimeError(f"refusing non-fast-forward history change on {BRANCH} ({last[:12]} -> {head[:12]})")
    signers = os.path.join(ETC, "allowed_signers")
    if os.path.exists(signers) and os.path.getsize(signers) > 0:
        r = subprocess.run(["git", "-c", "gpg.format=ssh", "-c", f"gpg.ssh.allowedSignersFile={signers}", "verify-commit", head],
                           cwd=repo, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"commit {head[:12]} is not signed by an allowed signer")
    git("-c", "advice.detachedHead=false", "checkout", "--quiet", "--force", "--detach", head, cwd=repo)
    return repo, head


def semver(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3])


def installed_version(binary):
    try:
        out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=20).stdout
        m = re.search(r"(\d+\.\d+\.\d+)", out)
        return m.group(1) if m else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def arch():
    return {"x86_64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}[os.uname().machine]


def maybe_upgrade(versions, state):
    """Upgrade stalwart / stalwart-cli to the pinned versions (never downgrade), with rollback."""
    for name, binary, service in (("cli", CLI, None), ("stalwart", SERVER_BIN, "stalwart")):
        spec = versions.get(name) or {}
        want, cur = spec.get("version"), installed_version(binary)
        if not want or not cur or semver(want) <= semver(cur):
            continue
        url = spec["url"].replace("{arch}", arch())
        digest = spec["sha256"][arch()]
        if not url.startswith(RELEASE_PREFIXES):
            raise ValueError(f"{name}: download URL not allowed")
        with tempfile.TemporaryDirectory() as tmp:
            archive = os.path.join(tmp, os.path.basename(url))
            urllib.request.urlretrieve(url, archive)
            if sha256_file(archive) != digest:
                raise ValueError(f"{name}: sha256 mismatch for {url}")
            with tarfile.open(archive) as tf:
                member = next(m for m in tf.getmembers() if m.isfile() and os.path.basename(m.name) == os.path.basename(binary))
                member.name = os.path.basename(binary)
                tf.extract(member, tmp, filter="data")
            new = os.path.join(tmp, os.path.basename(binary))
            shutil.copy2(binary, binary + ".prev")
            if service:
                subprocess.run(["systemctl", "stop", service], check=True)
            shutil.copy2(new, binary)
            os.chmod(binary, 0o755)
            if service:
                subprocess.run(["systemctl", "start", service], check=True)
                if not wait_http("http://127.0.0.1:8080/", 90):
                    shutil.copy2(binary + ".prev", binary)
                    subprocess.run(["systemctl", "restart", service])
                    raise RuntimeError(f"{name} {want} did not come up, rolled back to {cur}")
        log(f"upgraded {name} {cur} -> {want}")
        state.setdefault("upgrades", []).append({"name": name, "from": cur, "to": want, "at": now_iso()})


def wait_http(url, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=3)
            return True
        except urllib.error.HTTPError:
            return True
        except OSError:
            time.sleep(2)
    return False


def process_sealed(mail_dir, state):
    """mail/config/sealed/<name>.json: secrets the owner encrypted to this server's seal key (see mail/web)."""
    sealed_dir = os.path.join(mail_dir, "config", "sealed")
    if not os.path.isdir(sealed_dir):
        return
    key = load_seal_key()
    for fn in sorted(os.listdir(sealed_dir)):
        if not re.fullmatch(r"[a-z0-9-]{1,32}\.json", fn):
            continue
        name = fn[:-5]
        try:
            box = read_json(os.path.join(sealed_dir, fn))
            payload = json.loads(unseal(key, box))
            if payload.get("name") != name:
                raise ValueError("payload name does not match file name")
            if name == "backup":
                env = {k: str(v) for k, v in payload.get("env", {}).items() if k in BACKUP_ENV_KEYS}
                if not {"RESTIC_REPOSITORY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"} <= set(env):
                    raise ValueError("backup secret incomplete")
                write_private(os.path.join(ETC, "backup.env"), "".join(f"{k}={v}\n" for k, v in sorted(env.items())))
            state.setdefault("sealed", {})[name] = {"ok": True, "at": now_iso()}
        except Exception as e:  # noqa: BLE001 - reported in status, never the secret itself
            state.setdefault("sealed", {})[name] = {"ok": False, "error": type(e).__name__ + ": " + str(e)[:200]}


def build_pairing(mail_dir, out_dir):
    """mail/config/pairing/<name>.json = {"role":"owner","jwk":{...}} -> /fale/pairing/<name>.json (sealed)."""
    pdir = os.path.join(mail_dir, "config", "pairing")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    published = []
    if not os.path.isdir(pdir):
        return published
    agent_env = read_env_file(os.path.join(ETC, "agent.env"))
    secrets = read_env_file(os.path.join(ETC, "owner-secrets.env"))
    restic = read_text(os.path.join(ETC, "restic.pass")).strip() if os.path.exists(os.path.join(ETC, "restic.pass")) else None
    for fn in sorted(os.listdir(pdir)):
        if not re.fullmatch(r"[a-z0-9-]{1,32}\.json", fn):
            continue
        try:
            entry = read_json(os.path.join(pdir, fn))
            public_from_jwk(entry.get("jwk") or {})  # validates the key
        except Exception as e:  # noqa: BLE001
            log(f"pairing/{fn} ignored: {e}")
            continue
        if entry.get("role") != "owner":
            continue  # other roles (e.g. "backend" for the Vercel provisioning API) are designed, not enabled yet
        payload = {
            "server": MAIL_HOST, "createdAt": now_iso(),
            "admin": {"url": f"https://{MAIL_HOST}/admin", "user": agent_env.get("STALWART_USER", "admin"), "password": agent_env.get("STALWART_PASSWORD")},
            "postmaster": {"user": f"postmaster@{MAIL_DOMAIN}", "password": secrets.get("POSTMASTER_PASSWORD"),
                           "imap": f"{MAIL_HOST}:993 (TLS)", "smtp": f"{MAIL_HOST}:465 (TLS) or 587 (STARTTLS)"},
            "transactional": {"user": f"konto@{MAIL_DOMAIN}", "password": secrets.get("KONTO_PASSWORD"),
                              "smtp": f"{MAIL_HOST}:465 (implicit TLS)", "use": "Supabase Auth custom SMTP, FaLe One notifications"},
            "resticPassword": restic,
        }
        box = seal(entry["jwk"], json.dumps(payload).encode())
        write_private(os.path.join(out_dir, fn), json.dumps(box), 0o644)
        published.append(fn[:-5])
    return published


def cmd_gitops():
    state = load_state()
    g = state.setdefault("gitops", {})
    g["checkedAt"] = now_iso()
    try:
        repo, head = sync_repo(state)
        mail_dir = os.path.join(repo, "mail")
        manifest_hash = verify_manifest(mail_dir)
        plan_path = os.path.join(mail_dir, "config", "stalwart.ndjson")
        plan_text = read_text(plan_path)
        validate_plan(plan_text)
        maybe_upgrade(read_json(os.path.join(mail_dir, "config", "versions.json")), state)
        if not os.path.exists(os.path.join(VAR, "web", "fale-web.zip")):
            publish(force=True)  # the Application object below needs an existing bundle
        stale = time.time() - g.get("appliedEpoch", 0) > 6 * 3600
        if manifest_hash != g.get("manifest") or not g.get("ok") or stale:
            r = cli("apply", "--json", "--file", plan_path, check=False, timeout=600)
            results = ndjson(r.stdout)
            summary = next((x for x in results if x.get("op") == "summary"), {})
            if r.returncode != 0:
                failed = [x for x in results if x.get("status") not in (None, "ok")]
                raise RuntimeError(f"apply failed: {json.dumps(failed)[:600] or r.stderr[-600:]}")
            g.update({"appliedAt": now_iso(), "appliedEpoch": int(time.time()), "manifest": manifest_hash, "summary": summary.get("done")})
        process_sealed(mail_dir, state)
        web_src = os.path.join(mail_dir, "web")
        stage = os.path.join(VAR, "web", "src")
        os.makedirs(stage, exist_ok=True)
        for fn in os.listdir(stage):
            if fn not in ("status.json", "pairing") and os.path.isfile(os.path.join(stage, fn)):
                os.remove(os.path.join(stage, fn))
        for fn in os.listdir(web_src):
            shutil.copy2(os.path.join(web_src, fn), os.path.join(stage, fn))
        state["pairing"] = build_pairing(mail_dir, os.path.join(stage, "pairing"))
        g.update({"commit": head, "ok": True, "error": None})
    except Exception as e:  # noqa: BLE001
        g.update({"ok": False, "error": type(e).__name__ + ": " + str(e)[:400]})
        log(f"gitops error: {g['error']}")
    save_state(state)
    publish(force=True)
    return 0 if g["ok"] else 1


# ---------------------------------------------------------------- status
def parse_zone_dkim(zone, domain=MAIL_DOMAIN):
    """Extract DKIM records from the zone file text Stalwart generates (single or parenthesised multi-line TXT)."""
    out = []
    for m in re.finditer(r"^(\S+)\._domainkey\.%s\.\s+IN\s+TXT\s+(\([^)]*\)|\"[^\n]*\")" % re.escape(domain), zone, re.M):
        value = "".join(re.findall(r'"([^"]*)"', m.group(2)))
        alg = re.search(r"k=(\w+)", value)
        out.append({"selector": m.group(1), "algorithm": alg.group(1) if alg else "rsa", "value": value})
    return out


def cert_info(host=MAIL_HOST, port=443):
    from cryptography import x509
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    with socket.create_connection(("127.0.0.1", port), timeout=10) as s, ctx.wrap_socket(s, server_hostname=host) as t:
        der = t.getpeercert(binary_form=True)
    c = x509.load_der_x509_certificate(der)
    not_after = getattr(c, "not_valid_after_utc", None) or c.not_valid_after.replace(tzinfo=timezone.utc)
    try:
        sans = c.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        sans = []
    return {"issuer": c.issuer.rfc4514_string(), "notAfter": not_after.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "daysLeft": int((not_after - datetime.now(timezone.utc)).total_seconds() // 86400), "sans": sans}


def public_ips():
    ips = {"ipv4": None, "ipv6": None}
    for fam, key, target in ((socket.AF_INET, "ipv4", "1.1.1.1"), (socket.AF_INET6, "ipv6", "2606:4700:4700::1111")):
        try:
            with socket.socket(fam, socket.SOCK_DGRAM) as s:
                s.connect((target, 53))
                ip = s.getsockname()[0]
                if not ip.startswith(("10.", "192.168.", "172.", "fe80", "fd", "127.")):
                    ips[key] = ip
        except OSError:
            pass
    return ips


def dnsbl_check(ip):
    if not ip or ":" in ip:
        return {}
    rev = ".".join(reversed(ip.split(".")))
    res = {}
    for zone in DNSBL:
        try:
            a = socket.gethostbyname(f"{rev}.{zone}")
            res[zone] = "error" if a.startswith("127.255.255.") else f"listed:{a}"
        except socket.gaierror:
            res[zone] = "clean"
    return res


def ptr(ip):
    try:
        return socket.gethostbyaddr(ip)[0] if ip else None
    except OSError:
        return None


def port25_outbound():
    try:
        with socket.create_connection(("gmail-smtp-in.l.google.com", 25), timeout=8) as s:
            return s.recv(64).decode(errors="replace").startswith("220")
    except OSError:
        return False


def collect_status():
    st = load_state()
    status = {"schema": "fale-mail-status/1", "generatedAt": now_iso(), "host": MAIL_HOST, "domain": MAIL_DOMAIN,
              "agentVersion": AGENT_VERSION, "versions": {"stalwart": installed_version(SERVER_BIN), "cli": installed_version(CLI)}}
    try:
        status["os"] = dict(l.strip().split("=", 1) for l in read_text("/etc/os-release").splitlines() if "=" in l).get("PRETTY_NAME", "").strip('"')
    except OSError:
        pass
    status.update(public_ips())
    status["ptr"] = {"ipv4": ptr(status["ipv4"]), "ipv6": ptr(status["ipv6"])}
    status["blocklists"] = dnsbl_check(status["ipv4"])
    status["port25Outbound"] = port25_outbound()
    du = shutil.disk_usage("/var/lib/stalwart" if os.path.isdir("/var/lib/stalwart") else "/")
    status["disk"] = {"usedPct": round(100 * du.used / du.total, 1), "freeGB": round(du.free / 1e9, 1)}
    try:
        status["tls"] = cert_info()
    except Exception as e:  # noqa: BLE001
        status["tls"] = {"error": str(e)[:200]}
    try:
        status["queue"] = {"size": len(ndjson(cli("query", "QueuedMessage", "--json").stdout))}
        doms = ndjson(cli("query", "Domain", "--json").stdout)
        dom_id = next(d["id"] for d in doms if d.get("name") == MAIL_DOMAIN)
        zone = json.loads(cli("get", "Domain", dom_id, "--fields", "dnsZoneFile", "--json").stdout)["dnsZoneFile"]
        status["dkim"] = parse_zone_dkim(zone)
        status["zoneFile"] = zone
    except Exception as e:  # noqa: BLE001
        status["stalwartError"] = str(e)[:300]
    try:
        jwk = jwk_from_public(load_seal_key().public_key())
        status["sealPublicKey"] = {"jwk": jwk, "kid": kid_of(jwk)}
    except Exception:  # noqa: BLE001
        status["sealPublicKey"] = None
    g = st.get("gitops", {})
    status["gitops"] = {k: g.get(k) for k in ("commit", "ok", "error", "checkedAt", "appliedAt", "summary")}
    status["sealed"] = st.get("sealed", {})
    status["pairing"] = st.get("pairing", [])
    status["backup"] = st.get("backup", {"enabled": os.path.exists(os.path.join(ETC, "backup.env"))})
    status["upgrades"] = st.get("upgrades", [])[-5:]
    assert_public(status)
    return status


def assert_public(obj, path="status"):
    """Defence in depth: the status document must never carry anything secret-looking."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if SECRET_KEYS.search(k) and k not in ("sealPublicKey",):
                raise ValueError(f"refusing to publish secret-looking key {path}.{k}")
            assert_public(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            assert_public(v, f"{path}[{i}]")
    elif isinstance(obj, str) and "PRIVATE KEY" in obj:
        raise ValueError(f"refusing to publish key material at {path}")


def publish(force=False):
    """Zip mail/web + status.json + pairing/ and let Stalwart serve it under https://<host>/fale/."""
    web = os.path.join(VAR, "web")
    src = os.path.join(web, "src")
    os.makedirs(src, exist_ok=True)
    zpath = os.path.join(web, "fale-web.zip")
    files = []
    for root, _, names in os.walk(src):
        for n in sorted(names):
            files.append(os.path.relpath(os.path.join(root, n), src))
    material = hashlib.sha256()
    for rel in sorted(files):
        data = read_text(os.path.join(src, rel), "rb")
        if rel == "status.json":
            data = re.sub(rb'"(generatedAt|checkedAt)": "[^"]*"', b"", data)
        material.update(rel.encode() + b"\0" + hashlib.sha256(data).digest())
    st = load_state()
    pub = st.setdefault("publish", {})
    digest = material.hexdigest()
    if not force and digest == pub.get("digest") and time.time() - pub.get("epoch", 0) < 3 * 3600:
        return False
    tmp = zpath + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in sorted(files):
            z.write(os.path.join(src, rel), rel)
    os.chmod(tmp, 0o644)
    os.replace(tmp, zpath)
    r = subprocess.run([CLI, "--no-color", "create", "Action/UpdateApps"], env=cli_env(), capture_output=True, text=True, timeout=120)
    pub.update({"digest": digest, "epoch": int(time.time()), "ok": r.returncode == 0})
    save_state(st)
    return True


def cmd_status():
    status = collect_status()
    write_private(os.path.join(VAR, "web", "src", "status.json"), json.dumps(status, indent=1), 0o644)
    publish()
    return 0


# ---------------------------------------------------------------- backup
def cmd_backup():
    env_file = os.path.join(ETC, "backup.env")
    state = load_state()
    if not os.path.exists(env_file):
        state["backup"] = {"enabled": False, "note": "no sealed backup credentials yet (docs/FALE-MAIL.md#backups)"}
        save_state(state)
        return 0
    env = dict(os.environ, **read_env_file(env_file), RESTIC_PASSWORD_FILE=os.path.join(ETC, "restic.pass"))
    parent = "/var/backups/fale-mail"
    export = os.path.join(parent, "export")
    os.makedirs(parent, mode=0o700, exist_ok=True)
    shutil.chown(parent, "stalwart", "stalwart")
    b = {"enabled": True, "startedAt": now_iso()}
    try:
        if subprocess.run(["restic", "cat", "config"], env=env, capture_output=True).returncode != 0:
            subprocess.run(["restic", "init"], env=env, check=True, capture_output=True)
        shutil.rmtree(export, ignore_errors=True)
        subprocess.run(["systemctl", "stop", "stalwart"], check=True)
        try:
            subprocess.run(["runuser", "-u", "stalwart", "--", SERVER_BIN, "--config", "/etc/stalwart/config.json", "--export", export],
                           check=True, capture_output=True, timeout=3600)
        finally:
            subprocess.run(["systemctl", "start", "stalwart"], check=True)
        subprocess.run(["restic", "backup", "--quiet", "--tag", "fale-mail", export, "/etc/stalwart", ETC], env=env, check=True, capture_output=True)
        subprocess.run(["restic", "forget", "--quiet", "--prune", "--keep-daily", "7", "--keep-weekly", "5", "--keep-monthly", "12"],
                       env=env, check=True, capture_output=True)
        b.update({"ok": True, "lastSuccess": now_iso()})
    except Exception as e:  # noqa: BLE001
        b.update({"ok": False, "error": type(e).__name__, "lastSuccess": state.get("backup", {}).get("lastSuccess")})
    finally:
        shutil.rmtree(export, ignore_errors=True)
    state["backup"] = b
    save_state(state)
    return 0 if b.get("ok") else 1


def main(argv):
    cmds = {"keygen": cmd_keygen, "gitops": cmd_gitops, "status": cmd_status, "backup": cmd_backup}
    if len(argv) != 2 or argv[1] not in cmds:
        print("usage: fale-mail-agent {%s}" % "|".join(cmds), file=sys.stderr)
        return 2
    return cmds[argv[1]]() or 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
