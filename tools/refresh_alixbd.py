#!/usr/bin/env python3
"""Refresh the managed channels' URLs from RS Live TV's sources. (v8)

Replaces the v7 alixbd bot (same file path, same workflow, same CLI).
Ordered by Kauser 2026-11-24: the channels that used to load from
alixbd must now load from https://rslivetv.pages.dev/ instead.

How RS Live TV publishes its channels (from its public app.js):
- /settings.json lists public M3U playlists (GitHub-hosted, kept
  up to date by their owners — the Toffee playlist is refreshed
  daily, so the edge-cache tokens inside it are fresh).
- /bd76t2s1w9.json is an AES-GCM/PBKDF2-encrypted JSON channel list;
  the key sits in their public app.js (client-side, every visitor's
  browser decrypts it). This script decrypts it with `node`
  (preinstalled on GitHub runners); if node is missing, the JSON
  source is skipped and the playlists alone are used.

Scope — a FIXED managed set: the 12 channels whose main link was an
alixbd link when this version was written (MANAGED below). A managed
channel is hands-off forever once Kauser replaces its link with a
source of his own (current url neither alixbd nor one of the RS
source hosts this bot writes).

Safety rules (v7 spirit kept):
- Only `url` and `backup_url` of managed channels ever change.
- A globally-reachable candidate must pass the STRONG live check
  (playlist loads, first+last segments answer, media sequence
  advancing) TWICE in a row before it is written.
- Toffee CDN candidates are Bangladesh-only: they cannot be reached
  from the bot's foreign network at all (same class of problem as
  alixbd's https). For those, presence in RS's CURRENT published
  playlist is the proof — that playlist is auto-updated by its
  owner, so a listed link carries a fresh token. The app audience
  is in Bangladesh, where these links play.
- A channel's main link is replaced when it is an alixbd link (the
  migration Kauser ordered), or when it is an RS link that is no
  longer in RS's current list (stale token), or when it shows no
  proof of life in three fetches (v7 rule). If no candidate passes,
  the current link is kept untouched.
- backup_url: replaced by a second proven/published RS candidate
  when one exists; otherwise left exactly as Kauser/the bot set it.
- If RS's settings cannot be fetched, or the total parsed channel
  count looks wrong (<100), the script aborts and writes NOTHING.

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

# The 12 channels managed by this bot (Kauser's names, as in channels.json).
MANAGED = [
    "Sananda Tv", "Sony Max", "Sony Max 2", "AWSN TV", "Toffee TV",
    "Toffee Movies", "Zee Anmol", "Sony SAB HD", "Sony PIX HD",
    "Discovery Science", "Zee Cafe", "& Pictures HD",
]

# Hosts whose links this bot may write / has written. A managed channel
# whose current url is on none of these hosts and is not alixbd is
# Kauser's own source -> hands off.
RS_HOSTS = (
    "prod-linear-media.toffeelive.com",
    "bldcmprod-cdn.toffeelive.com",
    "toffeelive.com",
    "toffee.aliflaila.live",
    "live.sanandatelevision.in",
)
# Bangladesh-only hosts: unreachable from the bot's network by design.
BD_ONLY_HOSTS = ("prod-linear-media.toffeelive.com",
                 "bldcmprod-cdn.toffeelive.com",
                 "toffeelive.com")

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


def is_bd_only(url: str) -> bool:
    return host_of(url).endswith(BD_ONLY_HOSTS)


def is_rs_host(url: str) -> bool:
    h = host_of(url)
    return any(h == x or h.endswith("." + x) for x in RS_HOSTS)


def parse_m3u(content: str, label: str, by_name: dict):
    cur = None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            m = re.search(r",([^,]+)$", line)
            cur = m.group(1).strip() if m else None
        elif line and not line.startswith("#") and cur:
            by_name.setdefault(norm(cur), []).append((label, unwrap(line)))
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
    """BD-only (Toffee) candidates: presence in RS's freshly fetched
    list is the proof (they are unreachable from this network).
    Anything else must pass the strong check twice."""
    if is_bd_only(url):
        record(ch_key, label, True)
        return True
    return twice_proven(ch_key, label, url)


def process_channel(ch, by_name):
    """Returns a short log line. Mutates ch in place (url/backup_url)."""
    name = ch.get("name")
    key = norm(name or "")
    url = unwrap(ch.get("url") or "")
    if url != (ch.get("url") or ""):
        ch["url"] = url

    # Hands-off: Kauser's own source (not alixbd, not an RS host).
    if "alixbd.com" not in url and not is_rs_host(url):
        return f"  skipped (own source): {name}"

    cands = by_name.get(key) or []
    if not cands:
        return f"  unmatched in RS (kept): {name}"
    cand_urls = [u for _, u in cands]
    notes = []

    # --- main link ---
    if url in cand_urls:
        notes.append("main already current RS link")
    else:
        migrate = "alixbd.com" in url
        stale = is_rs_host(url)  # RS link no longer in RS's list
        dead = False
        if not migrate and not stale:
            dead = current_replaceable(url)
        if migrate or stale or dead:
            winner = None
            for label, cand in cands:
                if cand != url and candidate_ok(key, label, cand):
                    winner = cand
                    break
            if winner:
                ch["url"] = winner
                url = winner
                notes.append("main updated from RS")
            else:
                notes.append("no proven RS replacement (kept)")

    # --- backup link ---
    backup = unwrap(ch.get("backup_url") or "")
    if backup and backup != (ch.get("backup_url") or ""):
        ch["backup_url"] = backup
    if backup != url and backup in cand_urls:
        notes.append("backup current")
    else:
        spare = None
        for label, cand in cands:
            if cand != url and cand != backup and \
               candidate_ok(key, label, cand):
                spare = cand
                break
        if spare:
            ch["backup_url"] = spare
            notes.append("backup set from RS")
        elif "alixbd.com" in backup:
            notes.append("backup still alixbd (no RS spare)")

    return f"  {name}: " + ("; ".join(notes) if notes else "ok")


def main() -> int:
    global _stats
    path = sys.argv[1] if len(sys.argv) > 1 else "data/channels.json"

    try:
        by_name, total = load_rs_sources()
    except Exception as e:
        print(f"ABORT: could not load RS sources: {e}")
        return 2
    if total < 100:
        print(f"ABORT: only {total} channels parsed from RS sources")
        return 2
    print(f"RS sources parsed: {total} channel entries, "
          f"{len(by_name)} unique names")

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
    scoped = [c for c in channels if norm(c.get("name") or "") in managed_keys]
    print(f"managed channels found in DB: {len(scoped)}/{len(MANAGED)}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for line in ex.map(lambda c: process_channel(c, by_name), scoped):
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
