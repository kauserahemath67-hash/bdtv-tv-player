#!/usr/bin/env python3
"""Refresh ONLY the alixbd-linked channel URLs inside data/channels.json. (v3)

Safety rules:
- Only channels whose `url` contains "alixbd.com/proxy/proxy.php" or
  "alixbd.com/playlistconfig/" are ever considered. If Kauser replaces a
  channel's link with a non-alixbd source, this script never touches that
  channel again.
- A replacement URL is written ONLY after it passes a STRONG live
  check: playlist loads, first+last segments answer, and the live
  media sequence is actually advancing (not a frozen edge). If no candidate for a
  channel passes, the channel keeps its existing URL — a dead link is
  never written.
- If alixbd itself is unreachable or the parse looks wrong (<100 channels),
  the script aborts and writes NOTHING.
- Only the `url` field changes; every other field and channel is untouched.

Usage: python3 refresh_alixbd.py data/channels.json
Exit code 0 = done (updated or already fresh); 2 = aborted, nothing changed.
"""
import html as htmlmod
import json
import re
import sys
import urllib.parse
import urllib.request

HOME = "http://alixbd.com/"
PROXY = "http://alixbd.com/proxy/proxy.php?id="
LABEL_ORDER = ["server 1", "toffee", "ayna"]

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


def ordered(cands):
    """Candidates in preference order: direct URLs first, then label order."""
    direct = [c for c in cands if not c[1].startswith(PROXY)]
    rest = [c for c in cands if c[1].startswith(PROXY)]
    by_label = []
    for want in LABEL_ORDER:
        by_label += [c for c in rest if c[0].strip().lower() == want]
    by_label += [c for c in rest if c[0].strip().lower() not in LABEL_ORDER]
    return direct + by_label


def stream_alive(url: str) -> bool:
    """STRONG check: the stream must be genuinely flowing, not just answering.

    master loads -> variant loads -> at least the first AND last media
    segments answer 200/206 -> and, when the playlist carries a media
    sequence number, it must ADVANCE between two reads ~6s apart (a stuck
    sequence means a frozen/dead edge even if old segments still answer).
    """
    import time

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
        # Not a playlist (e.g. a raw .ts feed): probe the bytes directly.
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
        if m1:  # live playlist: the edge must be advancing
            time.sleep(6)
            _, vbody2 = get(variant)
            m2 = re.search(r"#EXT-X-MEDIA-SEQUENCE:(\d+)", vbody2)
            if not m2 or int(m2.group(1)) <= int(m1.group(1)):
                return False
        return True
    except Exception:
        return False


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "data/channels.json"

    try:
        by_name = parse_alixbd(fetch(HOME))
    except Exception as e:
        print(f"ABORT: could not fetch/parse alixbd: {e}")
        return 2
    if len(by_name) < 100:
        print(f"ABORT: only {len(by_name)} channels parsed from alixbd")
        return 2

    with open(path, encoding="utf-8") as f:
        channels = json.load(f)

    updated = unchanged = unmatched = kept_dead = 0
    for ch in channels:
        url = ch.get("url") or ""
        if "alixbd.com/proxy/proxy.php" not in url and \
           "alixbd.com/playlistconfig/" not in url:
            continue  # not an alixbd channel — never touched
        key = norm(ch.get("name", ""))
        cands = by_name.get(ALIASES.get(key, key))
        if not cands:
            unmatched += 1
            print(f"  unmatched (kept old URL): {ch.get('name')}")
            continue
        cands = ordered(cands)
        # Test the currently stored link first: if it is still live, keep it
        # (no needless churn). Otherwise pick the first candidate that is
        # verified live right now — the ACTIVE link always wins.
        urls = [u for _l, u in cands]
        if url in urls:
            urls.remove(url)
            urls.insert(0, url)
        fresh = None
        for cand in urls:
            if stream_alive(cand):
                fresh = cand
                break
        if fresh is None:
            kept_dead += 1
            print(f"  no live candidate (kept old URL): {ch.get('name')}")
            continue
        if fresh != url:
            ch["url"] = fresh
            updated += 1
            print(f"  updated: {ch.get('name')}")
        else:
            unchanged += 1

    print(f"alixbd channels: updated={updated} unchanged={unchanged} "
          f"unmatched={unmatched} kept-no-live={kept_dead}")
    if updated:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)
            f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
