#!/usr/bin/env python3
"""Refresh ONLY the alixbd-linked channel URLs inside data/channels.json. (v5)

Safety rules:
- Only channels whose `url` contains "alixbd.com/proxy/proxy.php" or
  "alixbd.com/playlistconfig/" are ever considered. If Kauser replaces a
  channel's link with a non-alixbd source, this script never touches that
  channel again.
- The CURRENT url of a channel is replaced ONLY when it shows NO
  proof of life: three separate fetches of its master playlist never
  once return a valid playlist. The alixbd proxy flaps per-request
  (the same id can answer 403/000 one minute and 200 the next), so a
  single failure proves nothing — but a link that cannot produce one
  valid playlist in three tries is treated as gone, while any link
  that answers even once (including one Kauser verified himself from
  Bangladesh) is kept untouched.
- A replacement URL is written ONLY after it proves itself the
  ACTIVE source: it must pass the STRONG live check (playlist loads,
  first+last segments answer, live media sequence advancing) TWICE
  in a row. All of the channel's sources compete; the first one to
  pass twice is picked. If none does, the channel keeps its URL.
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


def current_replaceable(url: str) -> bool:
    """True only if the current link shows NO proof of life: three
    fetches of its master playlist, none returning a valid playlist.

    The alixbd proxy flaps per-request, so one failure proves nothing;
    a single valid playlist response in any attempt means the link is
    alive (however flaky) and must be kept.
    """
    import time

    for attempt in range(3):
        try:
            body = fetch(url, timeout=15)
            if "#EXTM3U" in body:
                return False
        except Exception:
            pass
        if attempt < 2:
            time.sleep(5)
    return True


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
        if not current_replaceable(url):
            # Current link is not provably dead (it may be flaky, or
            # only failing from this network) — never overwrite it.
            unchanged += 1
            continue
        urls = [u for _l, u in cands if u != url]
        fresh = None
        for cand in urls:
            # The picked source must prove itself active TWICE in a
            # row — one lucky pass is not enough on this flaky proxy.
            if stream_alive(cand) and stream_alive(cand):
                fresh = cand
                break
        if fresh is None:
            kept_dead += 1
            print(f"  dead, no twice-proven candidate (kept old URL): {ch.get('name')}")
            continue
        ch["url"] = fresh
        updated += 1
        print(f"  updated (was lifeless): {ch.get('name')}")
    print(f"alixbd channels: updated={updated} unchanged={unchanged} "
          f"unmatched={unmatched} kept-no-live={kept_dead}")
    if updated:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)
            f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
