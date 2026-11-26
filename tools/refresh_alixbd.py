#!/usr/bin/env python3
"""Refresh the managed channels' URLs from RS Live TV + alixbd. (v11)

Dual-source successor of the v10 RS bot (same file path, same
workflow, same CLI). Ordered by Kauser 2026-11-26: the bot goes back
to taking links from alixbd like before AND keeps taking them from
RS Live TV. On every run it looks in BOTH sources, play-verifies the
candidates, and writes the link that actually plays as the main
link; if two links play, one becomes main and the other the backup.

How the alixbd side works now: alixbd.com (the "S-Live"/SBOX site)
is a JavaScript app. Its channel data (channels.json: names, match
aliases, categories, and a serverNames map that labels each stream
URL by host keyword - SBOX, Akash Go, Toffee, AYNA, AYNA(Proxy))
sits on top of merged playlists that the same operator builds and
auto-updates in his public GitHub repo (mahdiridoy/Tv): scan.m3u
and mahdi_iptv.m3u8. In those files one channel appears several
times with different stream URLs - those duplicates ARE the site's
Server 1 / Server 2 / Server 3. So the bot reads the same playlists
the site is built from, treats every same-name entry as one server
candidate, and play-verifies each one exactly like the RS ones.

Scope - unchanged from v10: the FIXED managed set of the original 24
bot-managed channels (MANAGED below), plus the WATCH set of 5 sports
channels on the problem-only rule (RS candidates only, as in v10).
NEVER_TOUCH (T Sports, Btv HD) is a hard guard, as before.

Selection rule for the 24 (Kauser, 2026-11-26):
- If the current main link still plays (strong check) - or, for
  Bangladesh-only Toffee links that cannot be reached from the
  bot's foreign network, is still present in a freshly fetched
  source list - it stays.
- Otherwise candidates are tested, alixbd's servers first, then
  RS's; the first one PROVEN to play (playlist loads, first+last
  segments answer, media sequence advancing - twice in a row)
  becomes the main link.
- If no candidate can be proven from this network, a Bangladesh-
  only (Toffee) candidate listed in a current source list is used
  (presence in the fresh list is the proof, as in v10).
- Backup: a second proven/published link, preferring one from the
  OTHER source than the main link's, so a channel ends up with one
  link from each site whenever both sites have a working one.
- If nothing qualifies, the current links stay untouched.

Safety rules (v10 spine kept):
- Only `url` and `backup_url` of managed/watch channels ever change.
- If BOTH sources fail to load or the total parsed channel count
  looks wrong (<100), the script aborts and writes NOTHING. If only
  one source loads, the run proceeds on that source alone and says
  so in the log.

Usage: python3 refresh_alixbd.py data/channels.json
Exit code 0 = done; 2 = aborted, nothing changed.
"""
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

RS_BASE = "https://rslivetv.pages.dev"
SETTINGS_URL = RS_BASE + "/settings.json"
JSON_URL = RS_BASE + "/bd76t2s1w9.json"
JSON_KEY = "Ho1fXTZ4gNTWGfmqFUVM5xCIgXWplXE8"  # from RS's public app.js
RS_PROXY_PREFIX = "https://stream-through-spark.lovable.app/api/proxy?u="

# alixbd's operator playlists (the data layer of the S-Live site).
ALIX_PLAYLISTS = [
    ("alixbd-scan", "https://raw.githubusercontent.com/mahdiridoy/Tv/main/scan.m3u"),
    ("alixbd-mahdi", "https://raw.githubusercontent.com/mahdiridoy/Tv/main/mahdi_iptv.m3u8"),
]

# The 24 channels managed by this bot (Kauser's current DB names).
MANAGED = [
    "Sony Sports 1", "Sony Sports 5", "Sony Ten Cricket",
    "WC Match Recap", "Somoy Tv", "ATN News", "Independent TV", "NTV",
    "Ekattor TV", "Ekhon TV", "Sananda Tv", "Sony Max", "Sony Max 2",
    "Toffee TV", "Toffee Movies", "AWSN TV", "Zee Anmol", "Sony SAB HD",
    "Sony PIX HD", "Discovery Science", "Zee Cafe", "& Pictures HD",
    "Cartoon Network HD +", "24/7 Anime",
]

# NEVER touch these, ever (Kauser, 2026-11-24): hard guard.
NEVER_TOUCH = {"t sports", "btv hd"}

# Watch set (Kauser, 2026-11-24): replace ONLY on problem, RS only.
WATCH = [
    "Sony Sports 2", "Sony Sports 3", "PTV Sports",
    "Star Sports 1", "Star Sports 2",
]
WATCH_ALIASES = {
    "sony sports 2": ["sony sports ten 2 hd", "sony ten sports 2 hd"],
    "sony sports 3": ["sony sports ten 3 hd", "sony ten sports 3 hd"],
    "ptv sports": ["ptv sports hd"],
    "star sports 1": ["star sports 1 hd"],
    "star sports 2": ["star sports 2 hd"],
}

# DB name (normalised) -> RS list names (normalised) for the same
# channel, when they differ from the DB name.
ALIASES = {
    "sony sports 1": ["sony sports ten 1 hd", "sony ten sports 1 hd"],
    "sony sports 5": ["sony sports ten 5 hd", "sony ten sports 5 hd"],
    "sony ten cricket": ["ten cricket"],
    "ekattor tv": ["ekattor hd"],
    "cartoon network hd +": ["cartoon network"],
    "& pictures hd": ["&pictures hd"],
}

# DB name (normalised) -> alixbd-side names (normalised). The v6
# alixbd aliases (verified against alixbd 2026-11-15) plus the RS
# ones that also occur in the operator playlists.
ALIX_ALIASES = {
    "sony sports 1": ["sony sports ten 1 hd", "sony ten sports 1 hd"],
    "sony sports 5": ["sony sports ten 5 hd", "sony ten sports 5 hd"],
    "sony ten cricket": ["ten cricket"],
    "atn news": ["atn news hd"],
    "ntv": ["ntv hd"],
    "ekattor tv": ["ekattor hd"],
    "sananda tv": ["sananda"],
    "sony max": ["sony max hd"],
    "sony max 2": ["sony max 2 hd"],
    "sony sab hd": ["sony sab"],
    "zee cafe": ["zee cafe hd"],
    "cartoon network hd +": ["cartoon network"],
    "& pictures hd": ["&pictures hd"],
}

# Bangladesh-only hosts: unreachable from the bot's network by design.
BD_ONLY_HOSTS = ("prod-linear-media.toffeelive.com",
                 "bldcmprod-cdn.toffeelive.com",
                 "toffeelive.com")

# Cap on strong (network) verifications per channel per run, so one
# channel with many dead servers cannot stall the whole run.
MAX_STRONG_TESTS = 6

STATS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "source_stats.json")
_stats_lock = threading.Lock()
_stats = {}


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def norm(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def host_of(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower()
    except Exception:
        return ""


def unwrap(url: str) -> str:
    """RS sometimes stores its own CORS-proxy form; keep the raw URL."""
    if url and url.startswith(RS_PROXY_PREFIX):
        return urllib.parse.unquote(url[len(RS_PROXY_PREFIX):])
    return url


def clean_url(url: str) -> str:
    """Operator playlists carry junk '#source' fragments on some URLs;
    a fragment is never part of the stream address."""
    url = (url or "").strip()
    if "#" in url:
        url = url.split("#", 1)[0]
    return url


def is_bd_only(url: str) -> bool:
    return host_of(url).endswith(BD_ONLY_HOSTS)


def parse_m3u(content: str, label: str, by_name: dict):
    cur = None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            m = re.search(r",([^,]+)$", line)
            cur = m.group(1).strip() if m else None
        elif line and not line.startswith("#") and cur:
            url = clean_url(line)
            if url.startswith("http"):
                by_name.setdefault(norm(cur), []).append((label, unwrap(url)))
            cur = None


def decrypt_rs_json(payload_text: str):
    """Decrypt RS's bd76t2s1w9.json using node (PBKDF2 + AES-256-GCM,
    exactly as their app.js does in the browser). Returns list of
    channel dicts, or [] when node/decryption is unavailable."""
    node_script = (
        "const fs=require('fs'),crypto=require('crypto');"
        "const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));"
        "const key=crypto.pbkdf2Sync(process.argv[2],"
        "Buffer.from(p.salt,'base64'),p.iterations,32,'sha256');"
        "const data=Buffer.from(p.data,'base64');"
        "const tag=data.subarray(data.length-16);"
        "const ct=data.subarray(0,data.length-16);"
        "const d=crypto.createDecipheriv('aes-256-gcm',key,"
        "Buffer.from(p.iv,'base64'));d.setAuthTag(tag);"
        "process.stdout.write(Buffer.concat([d.update(ct),d.final()])"
        ".toString('utf8'));"
    )
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".json",
                                         delete=False) as f:
            f.write(payload_text)
            tmp = f.name
        try:
            out = subprocess.run(["node", "-e", node_script, tmp, JSON_KEY],
                                 capture_output=True, text=True, timeout=60)
        finally:
            os.unlink(tmp)
        if out.returncode != 0:
            return []
        parsed = json.loads(out.stdout)
        arr = parsed if isinstance(parsed, list) else parsed.get("channels", [])
        return [c for c in arr if isinstance(c, dict)]
    except Exception:
        return []


def load_rs_sources():
    """Returns (by_name, total_count). by_name: normalised name ->
    [(label, url), ...] in RS's own merge order (playlists in
    settings order, then the JSON list)."""
    settings = json.loads(fetch(SETTINGS_URL))
    by_name = {}
    total = 0
    playlists = []
    if isinstance(settings.get("m3uPlaylists"), list):
        playlists = [p for p in settings["m3uPlaylists"]
                     if p and p.get("enabled") is not False and p.get("url")]
    for i, p in enumerate(playlists):
        try:
            before = sum(len(v) for v in by_name.values())
            parse_m3u(fetch(p["url"]), f"playlist{i}", by_name)
            total += sum(len(v) for v in by_name.values()) - before
        except Exception as e:
            print(f"  warn: playlist {i} failed: {e}")
    try:
        arr = decrypt_rs_json(fetch(JSON_URL))
        for c in arr:
            url = c.get("url") or c.get("link")
            if c.get("name") and url:
                by_name.setdefault(norm(c["name"]), []).append(
                    ("rs-json", unwrap(str(url))))
                total += 1
    except Exception as e:
        print(f"  warn: RS json source failed: {e}")
    return by_name, total


def load_alix_sources():
    """alixbd side: the operator's merged playlists (scan.m3u +
    mahdi_iptv.m3u8). Same-name duplicates = the site's servers.
    Returns (by_name, total_count) like load_rs_sources."""
    by_name = {}
    total = 0
    for label, url in ALIX_PLAYLISTS:
        before = sum(len(v) for v in by_name.values())
        parse_m3u(fetch(url, timeout=60), label, by_name)
        total += sum(len(v) for v in by_name.values()) - before
    # Dedupe per name, preserving order (the playlists repeat a lot).
    for key in by_name:
        seen = set()
        uniq = []
        for label, u in by_name[key]:
            if u not in seen:
                seen.add(u)
                uniq.append((label, u))
        by_name[key] = uniq
    return by_name, total


def record(ch_key: str, label: str, ok: bool):
    with _stats_lock:
        entry = _stats.setdefault(ch_key, {}).setdefault(
            label.strip().lower(), {"pass": 0, "fail": 0})
        entry["pass" if ok else "fail"] += 1


def proof_of_life(url: str) -> bool:
    try:
        return "#EXTM3U" in fetch(url, timeout=15)
    except Exception:
        return False


def current_replaceable(url: str) -> bool:
    """True only if the current link shows NO proof of life in three
    fetches. A single valid playlist in any attempt means: keep it."""
    for attempt in range(3):
        if proof_of_life(url):
            return False
        if attempt < 2:
            time.sleep(5)
    return True


def stream_alive(url: str) -> bool:
    """STRONG check: playlist loads, first AND last segments answer
    200/206, and the live media sequence ADVANCES between two reads."""
    def get(u, rng=False):
        h = {"User-Agent": "Mozilla/5.0"}
        if rng:
            h["Range"] = "bytes=0-1023"
        req = urllib.request.Request(u, headers=h)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8", errors="ignore")

    try:
        _, body = get(url)
    except Exception:
        return False
    if "#EXTM3U" not in body:
        try:
            st, _ = get(url, rng=True)
            return st in (200, 206)
        except Exception:
            return False
    targets = [l.strip() for l in body.splitlines()
               if l.strip() and not l.startswith("#")]
    if not targets:
        return False
    try:
        variant = urllib.parse.urljoin(url, targets[0])
        _, vbody = get(variant)
        if "#EXTM3U" not in vbody:
            st, _ = get(variant, rng=True)
            return st in (200, 206)
        segs = [l.strip() for l in vbody.splitlines()
                if l.strip() and not l.startswith("#")]
        if len(segs) < 2:
            return False
        for s in (segs[0], segs[-1]):
            st, _ = get(urllib.parse.urljoin(variant, s), rng=True)
            if st not in (200, 206):
                return False
        m1 = re.search(r"#EXT-X-MEDIA-SEQUENCE:(\d+)", vbody)
        if m1:
            time.sleep(6)
            _, vbody2 = get(variant)
            m2 = re.search(r"#EXT-X-MEDIA-SEQUENCE:(\d+)", vbody2)
            if not m2 or int(m2.group(1)) <= int(m1.group(1)):
                return False
        return True
    except Exception:
        return False


def twice_proven(ch_key: str, label: str, url: str) -> bool:
    ok1 = stream_alive(url)
    record(ch_key, label, ok1)
    if not ok1:
        return False
    ok2 = stream_alive(url)
    record(ch_key, label, ok2)
    return ok2


def candidate_ok(ch_key: str, label: str, url: str) -> bool:
    """BD-only (Toffee) candidates: presence in a freshly fetched
    list is the proof (they are unreachable from this network).
    Anything else must pass the strong check twice."""
    if is_bd_only(url):
        record(ch_key, label, True)
        return True
    return twice_proven(ch_key, label, url)


def gather(by_name, key, aliases):
    cands = list(by_name.get(key) or [])
    for alias in aliases.get(key, []):
        cands += by_name.get(alias) or []
    seen = set()
    out = []
    for label, u in cands:
        if u not in seen:
            seen.add(u)
            out.append((label, u))
    return out


class Prover:
    """Per-channel memoised play-verification with a test budget."""

    def __init__(self, ch_key, published_urls):
        self.key = ch_key
        self.published = published_urls  # urls in a fresh source list
        self.memo = {}
        self.budget = MAX_STRONG_TESTS

    def state(self, label, url):
        """-> 'proven' | 'published' | 'dead' | 'unknown'
        'published' = BD-only link present in a fresh source list.
        'unknown' = could not be tested within this run's budget."""
        if url in self.memo:
            return self.memo[url]
        if is_bd_only(url):
            st = "published" if url in self.published else "dead"
            record(self.key, label, st == "published")
            self.memo[url] = st
            return st
        if self.budget <= 0:
            return "unknown"
        self.budget -= 1
        st = "proven" if twice_proven(self.key, label, url) else "dead"
        self.memo[url] = st
        return st


def process_channel(ch, rs_by, alix_by):
    """Managed 24, Kauser's dual-source rule (see module docstring).
    Mutates ch in place (url/backup_url). Returns a log line."""
    name = ch.get("name")
    key = norm(name or "")
    url = unwrap(ch.get("url") or "")
    if url != (ch.get("url") or ""):
        ch["url"] = url
    backup = unwrap(ch.get("backup_url") or "")
    if backup and backup != (ch.get("backup_url") or ""):
        ch["backup_url"] = backup

    rs_cands = gather(rs_by, key, ALIASES)
    alix_cands = gather(alix_by, key, ALIX_ALIASES)
    if not rs_cands and not alix_cands:
        return f"  unmatched in both sources (kept): {name}"
    rs_urls = {u for _, u in rs_cands}
    alix_urls = {u for _, u in alix_cands}
    published = rs_urls | alix_urls
    prover = Prover(key, published)
    # Kauser's order: alixbd's servers first, then RS.
    pools = [("alixbd", alix_cands), ("rs", rs_cands)]
    notes = []

    def pool_of(u):
        if u in alix_urls:
            return "alixbd"
        if u in rs_urls:
            return "rs"
        return None

    def label_of(u):
        for _, cands in pools:
            for label, cand in cands:
                if cand == u:
                    return label
        return "current"

    # --- main link ---
    main = url
    cur_state = prover.state(label_of(url), url) if url else "dead"
    if cur_state in ("proven", "published"):
        notes.append(f"main kept ({cur_state})")
    else:
        winner = None
        for pool, cands in pools:
            for label, cand in cands:
                if cand == url:
                    continue
                if prover.state(label, cand) == "proven":
                    winner = cand
                    break
            if winner:
                break
        if not winner:  # fall back to a published BD-only candidate
            for pool, cands in pools:
                for label, cand in cands:
                    if cand != url and prover.state(label, cand) == "published":
                        winner = cand
                        break
                if winner:
                    break
        if winner:
            ch["url"] = winner
            main = winner
            notes.append(f"main updated from {pool_of(winner) or 'source'}")
        else:
            notes.append("no live replacement (kept)")

    # --- backup link: a second live link, other source preferred ---
    backup_ok = False
    if backup and backup != main:
        backup_ok = prover.state(label_of(backup), backup) in (
            "proven", "published")
    if backup_ok:
        notes.append("backup kept (live)")
    else:
        main_pool = pool_of(main)
        ordered = []
        for pool, cands in pools:
            if pool != main_pool:
                ordered += cands
        for pool, cands in pools:
            if pool == main_pool:
                ordered += cands
        spare = None
        for label, cand in ordered:
            if cand == main or cand == backup:
                continue
            if prover.state(label, cand) in ("proven", "published"):
                spare = cand
                break
        if spare:
            ch["backup_url"] = spare
            notes.append(f"backup set from {pool_of(spare) or 'source'}")
        elif backup:
            notes.append("backup kept (no proven spare)")

    return f"  {name}: " + ("; ".join(notes) if notes else "ok")


def process_watch_channel(ch, by_name):
    """Watch set: touch the main link ONLY when it shows a problem
    (no proof of life in 3 fetches). BD-only current links cannot be
    judged from this network - those are left alone. (v10, RS only.)"""
    name = ch.get("name")
    key = norm(name or "")
    url = unwrap(ch.get("url") or "")
    if url != (ch.get("url") or ""):
        ch["url"] = url
    cands = gather(by_name, key, WATCH_ALIASES)
    if not cands:
        return f"  [watch] unmatched in RS (kept): {name}"
    cand_urls = [u for _, u in cands]
    if url in cand_urls:
        return f"  [watch] {name}: already RS link, ok"
    if is_bd_only(url):
        return f"  [watch] {name}: BD-only link, cannot judge (kept)"
    if not current_replaceable(url):
        return f"  [watch] {name}: link alive, ok"
    winner = None
    for label, cand in cands:
        if cand != url and candidate_ok(key, label, cand):
            winner = cand
            break
    if not winner:
        return f"  [watch] {name}: link dead, no proven RS spare (kept)"
    ch["url"] = winner
    return f"  [watch] {name}: link dead -> replaced from RS"


def main() -> int:
    global _stats
    path = sys.argv[1] if len(sys.argv) > 1 else "data/channels.json"

    rs_by, rs_total = {}, 0
    try:
        rs_by, rs_total = load_rs_sources()
        print(f"RS sources parsed: {rs_total} channel entries, "
              f"{len(rs_by)} unique names")
    except Exception as e:
        print(f"  warn: RS sources failed: {e}")
    alix_by, alix_total = {}, 0
    try:
        alix_by, alix_total = load_alix_sources()
        print(f"alixbd sources parsed: {alix_total} channel entries, "
              f"{len(alix_by)} unique names")
    except Exception as e:
        print(f"  warn: alixbd sources failed: {e}")
    if rs_total + alix_total < 100 or (not rs_by and not alix_by):
        print(f"ABORT: only {rs_total + alix_total} channels parsed "
              f"from both sources")
        return 2

    if os.path.exists(STATS_PATH):
        try:
            with open(STATS_PATH, encoding="utf-8") as f:
                _stats = json.load(f)
        except Exception:
            _stats = {}

    with open(path, encoding="utf-8") as f:
        raw_doc = json.load(f)
    was_dict = isinstance(raw_doc, dict)
    channels = raw_doc.get("data", []) if was_dict else raw_doc
    before = json.dumps(channels, ensure_ascii=False, sort_keys=True)

    managed_keys = {norm(n) for n in MANAGED}
    scoped = [c for c in channels
              if norm(c.get("name") or "") in managed_keys
              and norm(c.get("name") or "") not in NEVER_TOUCH]
    print(f"managed channels found in DB: {len(scoped)}/{len(MANAGED)}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for line in ex.map(
                lambda c: process_channel(c, rs_by, alix_by), scoped):
            print(line, flush=True)
    watch_keys = {norm(n) for n in WATCH}
    watched = [c for c in channels
               if norm(c.get("name") or "") in watch_keys
               and norm(c.get("name") or "") not in NEVER_TOUCH]
    print(f"watch channels found in DB: {len(watched)}/{len(WATCH)}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for line in ex.map(lambda c: process_watch_channel(c, rs_by),
                           watched):
            print(line, flush=True)

    after = json.dumps(channels, ensure_ascii=False, sort_keys=True)
    changed = before != after
    print(f"channels.json changed: {changed}")
    if changed:
        out_doc = raw_doc if was_dict else channels
        if was_dict:
            out_doc["data"] = channels
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out_doc, f, ensure_ascii=False, indent=2)
            f.write("\n")
    with open(STATS_PATH, "w", encoding="utf-8") as f:
        json.dump(_stats, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
