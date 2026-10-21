#!/usr/bin/env python3
"""Babylon.js research helper: docs, API, examples, forum and engine source, from the terminal.

Usage (run from the project root, so the installed version is found):
  bjs.py version                     installed @babylonjs/* versions (the API you must target)
  bjs.py search <words...>           doc pages whose URL matches all words (sitemap, cached a day)
  bjs.py doc <url|path>              a doc page as raw markdown (from the Documentation repo)
  bjs.py api <Symbol> [--src]        where Symbol is declared in node_modules/@babylonjs, with its .d.ts block
                                     (--src: also the compiled .js implementation)
  bjs.py grep <regex> [--js]         search the installed .d.ts files (or .js with --js) for a pattern
  bjs.py pg <id>[#rev]               a Playground snippet's code (ids look like P8B91Z#127)
  bjs.py forum <words...>            top forum topics (titles + URLs)
  bjs.py topic <id|url>              a forum topic's posts, as plain text
  bjs.py code <words...>             GitHub code search in BabylonJS/Babylon.js (needs gh auth)
  bjs.py changes [words...]          breaking changes / what's new pages, optionally filtered

Stdlib only. Network results are cached under ~/.cache/bjs-skill.
"""
import html
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "bjs-skill"
DOCS = "https://doc.babylonjs.com"
RAW = "https://raw.githubusercontent.com/BabylonJS/Documentation/master/content"
UA = {"User-Agent": "bjs-skill/1.0"}


def fetch(url: str, ttl: int = 86400) -> str:
    """GET with a small disk cache (ttl seconds)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / re.sub(r"[^A-Za-z0-9._-]", "_", url)[-180:]
    if f.exists() and time.time() - f.stat().st_mtime < ttl:
        return f.read_text(encoding="utf-8")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    f.write_text(body, encoding="utf-8")
    return body


def node_modules() -> Path:
    d = Path.cwd()
    for p in [d, *d.parents]:
        if (p / "node_modules" / "@babylonjs").is_dir():
            return p / "node_modules" / "@babylonjs"
    sys.exit("node_modules/@babylonjs not found from the current directory: run from the project root.")


def cmd_version(_):
    nm = node_modules()
    for pkg in sorted(nm.iterdir()):
        pj = pkg / "package.json"
        if pj.exists():
            print(f"@babylonjs/{pkg.name} {json.loads(pj.read_text())['version']}")


def sitemap() -> list[str]:
    xml = fetch(f"{DOCS}/sitemap.xml")
    return re.findall(r"<loc>([^<]+)</loc>", xml)


def cmd_search(args):
    words = [w.lower() for w in args]
    if not words:
        sys.exit("search: give at least one word")
    hits = [u for u in sitemap() if all(w in u.lower() for w in words)]
    # Guides first, then the typedoc API pages.
    hits.sort(key=lambda u: ("/typedoc/" in u, len(u)))
    for u in hits[:40]:
        print(u)
    if len(hits) > 40:
        print(f"... {len(hits) - 40} more; add a word to narrow")
    if not hits:
        print("no URL matches; try fewer/other words, `forum`, or `code`")


def cmd_doc(args):
    if not args:
        sys.exit("doc: give a URL or a path like features/featuresDeepDive/mesh/copies/thinInstances")
    path = args[0].split("doc.babylonjs.com")[-1].strip("/").split("#")[0]
    if path.startswith("typedoc/"):
        # API pages are generated HTML: strip the tags.
        page = fetch(f"{DOCS}/{path}")
        text = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
        print(re.sub(r"\s{2,}", "\n", text)[:20000])
        return
    try:
        md = fetch(f"{RAW}/{path}.md")
    except Exception:
        md = fetch(f"{RAW}/{path}/index.md")
    print(md)
    pgs = sorted(set(re.findall(r"#([A-Z0-9]{5,7}#\d+)", md)))
    if pgs:
        print("\n---\nPlayground examples referenced (bjs.py pg <id>):", " ".join(pgs[:20]))


def dts_files(js: bool = False):
    ext = ".js" if js else ".d.ts"
    for p in node_modules().rglob(f"*{ext}"):
        if ext == ".js" and p.name.endswith(".d.ts"):
            continue
        if "/node_modules/" in str(p.relative_to(node_modules())):
            continue
        yield p


def cmd_api(args):
    if not args:
        sys.exit("api: give a class/function/interface name")
    sym = args[0]
    with_src = "--src" in args
    decl = re.compile(rf"^(export )?(declare )?(abstract )?(class|interface|function|type|const|enum) {re.escape(sym)}\b", re.M)
    found = False
    for f in dts_files():
        t = f.read_text(encoding="utf-8", errors="replace")
        m = decl.search(t)
        if not m:
            continue
        found = True
        rel = f.relative_to(node_modules().parent)
        print(f"== {rel}")
        # Print from the doc comment above the declaration to the matching closing brace (capped).
        start = t.rfind("/**", 0, m.start())
        start = start if start != -1 and m.start() - start < 2000 else m.start()
        end = t.find("\n}", m.start())
        print(t[start:(end + 2 if end != -1 else m.start() + 4000)][:12000])
        if with_src:
            js = f.with_name(f.name.replace(".d.ts", ".js"))
            if js.exists():
                print(f"\n== {js.relative_to(node_modules().parent)} (implementation)")
                print(js.read_text(encoding="utf-8", errors="replace")[:15000])
    if not found:
        print(f"{sym}: no declaration found; try `bjs.py grep {sym}`")


def cmd_grep(args):
    if not args:
        sys.exit("grep: give a regex")
    rx = re.compile(args[0])
    js = "--js" in args
    n = 0
    for f in dts_files(js):
        for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if rx.search(line):
                print(f"{f.relative_to(node_modules().parent)}:{i}: {line.strip()[:200]}")
                n += 1
                if n >= 80:
                    print("... (80 shown; refine the pattern)")
                    return


def cmd_pg(args):
    if not args:
        sys.exit("pg: give a snippet id like P8B91Z#127")
    ident = args[0].lstrip("#").replace("#", "/")
    data = json.loads(fetch(f"https://snippet.babylonjs.com/{ident}", ttl=7 * 86400))
    payload = json.loads(data["jsonPayload"])
    print(f"// Playground {args[0]} ({payload.get('engine', '?')}) - https://playground.babylonjs.com/#{args[0].lstrip('#')}")
    print(payload["code"])


def cmd_forum(args):
    q = urllib.parse.quote(" ".join(args))
    d = json.loads(fetch(f"https://forum.babylonjs.com/search.json?q={q}", ttl=3600))
    for t in d.get("topics", [])[:15]:
        print(f"{t['id']:>6}  {t['title']}  https://forum.babylonjs.com/t/{t['slug']}/{t['id']}")
    if not d.get("topics"):
        print("no topic found")


def cmd_topic(args):
    if not args:
        sys.exit("topic: give a topic id or URL")
    tid = re.findall(r"\d+", args[0].rstrip("/").split("/")[-1] if "/" in args[0] else args[0])[0]
    if "/t/" in args[0]:
        tid = re.findall(r"/t/[^/]+/(\d+)", args[0])[0]
    d = json.loads(fetch(f"https://forum.babylonjs.com/t/{tid}.json", ttl=3600))
    print(f"# {d['title']}\n")
    for p in d["post_stream"]["posts"][:20]:
        text = html.unescape(re.sub(r"<[^>]+>", "", p["cooked"]))
        print(f"--- {p['username']}{' (staff)' if p.get('staff') else ''}:\n{text.strip()[:3000]}\n")


def cmd_code(args):
    q = " ".join(args)
    r = subprocess.run(["gh", "search", "code", q, "--repo", "BabylonJS/Babylon.js", "--limit", "20",
                        "--json", "path,url"], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"gh search failed (is gh authenticated?): {r.stderr.strip()}")
    for h in json.loads(r.stdout):
        print(f"{h['path']}  {h['url']}")


def cmd_changes(args):
    for path in ("breaking-changes", "whats-new"):
        md = fetch(f"{RAW}/{path}.md")
        if args:
            words = [w.lower() for w in args]
            paras = [p for p in md.split("\n\n") if all(w in p.lower() for w in words)]
            print(f"== {path}: {len(paras)} matching paragraph(s)\n" + "\n\n".join(paras[:30]))
        else:
            print(f"== {path}\n{md[:8000]}")


CMDS = {"version": cmd_version, "search": cmd_search, "doc": cmd_doc, "api": cmd_api, "grep": cmd_grep,
        "pg": cmd_pg, "forum": cmd_forum, "topic": cmd_topic, "code": cmd_code, "changes": cmd_changes}

if __name__ == "__main__":
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # `| head` ends quietly
    if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
        print(__doc__)
        sys.exit(1)
    try:
        CMDS[sys.argv[1]](sys.argv[2:])
    except urllib.error.URLError as e:
        sys.exit(f"network error: {e}")
