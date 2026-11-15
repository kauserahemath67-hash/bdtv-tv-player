#!/usr/bin/env python3
"""Refresh the alixbd-linked channel URLs inside data/channels.json. (v6)

Upgrades over v5:
- PARALLEL: channels are processed concurrently (6 workers), so a run
  takes minutes, not half an hour.
- SOURCE MEMORY: tools/source_stats.json (kept next to this script)
  records, per channel and per source label, how often each source
  passed the strong check. Candidates are tried in order of their
  proven track record for that channel first.
- BACKUP LINK: for every in-scope channel the bot also maintains
  `backup_url` with a second, twice-proven active source (approved by
  Kauser 2026-11-15), so the app has a spare when the main link dies.

Safety rules (unchanged in spirit):
- Only channels whose `url` contains "alixbd.com/proxy/proxy.php" or
  "alixbd.com/playlistconfig/" are ever considered. If Kauser replaces
  a channel's link with a non-alixbd source, this script never touches
  that channel again (neither url nor backup_url).
- The CURRENT url is replaced ONLY when it shows NO proof of life:
  three fetches of its master playlist never once return a valid
  playlist. Any link that answers even once (including one Kauser
  verified himself from Bangladesh) is kept untouched.
- A written link (main or backup) must prove itself ACTIVE: pass the
  STRONG live check (playlist loads, first+last segments answer, live
  media sequence advancing) TWICE in a row.
- backup_url is only ever REPLACED by a twice-proven link, and only
  when the existing backup is lifeless or missing. A backup Kauser set
  himself is never deleted without a proven replacement.
- If alixbd is unreachable or the parse looks wrong (<100 channels),
  the script aborts and writes NOTHING.
- Only `url` and `backup_url` of in-scope channels ever change.

Usage: python3 refresh_alixbd.py data/channels.json
Exit code 0 = done; 2 = aborted, nothing changed.
"""
import concurrent.futures
import html as htmlmod
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request

HOME = "http://alixbd.com/"
PROXY = "http://alixbd.com/proxy/proxy.php?id="
LABEL_ORDER = ["server 1", "toffee", "ayna"]
STATS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "source_stats.json")

# His channel name (normalised) -> alixbd's name (normalised), for channels
# whose names differ between the two lists. Verified against alixbd 2026-11-15.
ALIASES = {
    "sony ten cricket": "ten cricket",
    "atn news": "atn news hd",
    "ntv": "ntv hd",
    "ekattor tv": "ekattor hd",
    "sananda tv": "sananda",
    "sony max": "sony max hd",
    "sony max 2": "sony max 2 hd",
    "sony sab hd": "sony sab",
    "zee cafe": "zee cafe hd",
}

_stats_lock = threading.Lock()
_stats = {}


def fetch(url: str, timeout: int = 60) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def norm(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def parse_alixbd(raw: str):
    cards = {}
    for m in re.finditer(
        r'<article class="channel" data-channel="([a-f0-9]+)"[^>]*>(.*?)</article>',
        raw,
        re.S,
    ):
        cid, body = m.group(1), m.group(2)
        name = re.search(r"<strong>(.*?)</strong>", body, re.S)
        if name:
            cards[cid] = htmlmod.unescape(name.group(1).strip())

    by_name = {}
    for m in re.finditer(
        r'<div class="server-group" data-channel="([a-f0-9]+)">(.*?)</div>', raw, re.S
    ):
        cid, body = m.group(1), m.group(2)
        name = cards.get(cid)
        if not name:
            continue
        cands = []
        for b in re.finditer(
            r'<button class="source" data-stream="([a-f0-9]+)" data-type="([^"]*)" '
            r'data-direct-url="([^"]*)"[^>]*>(.*?)</button>',
            body,
            re.S,
        ):
            label = htmlmod.unescape(b.group(4).strip())
            url = b.group(3) if b.group(3) else PROXY + b.group(1)
            cands.append((label, url))
        if cands:
            by_name[norm(name)] = cands
    return by_name


def record(ch_key: str, label: str, ok: bool):
    with _stats_lock:
        entry = _stats.setdefault(ch_key, {}).setdefault(
            label.strip().lower(), {"pass": 0, "fail": 0})
        entry["pass" if ok else "fail"] += 1


def ordered(cands, ch_key: str):
    """Direct URLs first; within each group, sources with the best
    proven track record for THIS channel come first, then label order."""
    def rank(item):
        label, url = item
        st = _stats.get(ch_key, {}).get(label.strip().lower(),
                                        {"pass": 0, "fail": 0})
        total = st["pass"] + st["fail"]
        rate = (st["pass"] / total) if total else -1
        try:
            label_idx = LABEL_ORDER.index(label.strip().lower())
        except ValueError:
            label_idx = len(LABEL_ORDER)
        return (0 if not url.startswith(PROXY) else 1,
                -st["pass"], -rate, label_idx)

    return sorted(cands, key=rank)


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


def process_channel(ch, by_name):
    """Returns a short log line. Mutates ch in place (url/backup_url)."""
    url = ch.get("url") or ""
    name = ch.get("name")
    key = norm(name or "")
    cands = by_name.get(ALIASES.get(key, key))
    if not cands:
        return f"  unmatched (kept): {name}"
    cands = ordered(cands, key)
    notes = []

    # --- main link ---
    if current_replaceable(url):
        winner = None
        for label, cand in cands:
            if cand != url and twice_proven(key, label, cand):
                winner = cand
                break
        if winner:
            ch["url"] = winner
            url = winner
            notes.append("main updated")
        else:
            notes.append("main lifeless, no proven replacement")

    # --- backup link ---
    backup = ch.get("backup_url") or ""
    if not backup or backup == url or not proof_of_life(backup):
        spare = None
        for label, cand in cands:
            if cand != url and cand != backup and \
               twice_proven(key, label, cand):
                spare = cand
                break
        if spare:
            ch["backup_url"] = spare
            notes.append("backup set")
        elif backup and backup != url and not proof_of_life(backup):
            notes.append("backup lifeless, no proven spare (kept)")

    return f"  {name}: " + ("; ".join(notes) if notes else "ok")


def main() -> int:
    global _stats
    path = sys.argv[1] if len(sys.argv) > 1 else "data/channels.json"

    try:
        by_name = parse_alixbd(fetch(HOME))
    except Exception as e:
        print(f"ABORT: could not fetch/parse alixbd: {e}")
        return 2
    if len(by_name) < 100:
        print(f"ABORT: only {len(by_name)} channels parsed from alixbd")
        return 2

    if os.path.exists(STATS_PATH):
        try:
            with open(STATS_PATH, encoding="utf-8") as f:
                _stats = json.load(f)
        except Exception:
            _stats = {}

    with open(path, encoding="utf-8") as f:
        channels = json.load(f)
    before = json.dumps(channels, ensure_ascii=False, sort_keys=True)

    scoped = [c for c in channels
              if "alixbd.com/proxy/proxy.php" in (c.get("url") or "")
              or "alixbd.com/playlistconfig/" in (c.get("url") or "")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for line in ex.map(lambda c: process_channel(c, by_name), scoped):
            print(line, flush=True)

    after = json.dumps(channels, ensure_ascii=False, sort_keys=True)
    changed = before != after
    print(f"in-scope channels: {len(scoped)} | channels.json changed: {changed}")
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)
            f.write("\n")
    with open(STATS_PATH, "w", encoding="utf-8") as f:
        json.dump(_stats, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
