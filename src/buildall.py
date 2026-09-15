"""Build Settle's index.html (and the test harness) from the source files in
this directory. Run as `python src/buildall.py` from the repo root, or from
anywhere - every path below is resolved relative to this script's own
location and the repo root one level above it, never to the caller's
working directory.

    python src/buildall.py

Every editable line the app is made of lives here, in src/ - nine files for
the page itself (app-head.html through app-boot.js, in the order they run)
plus app-print.css and harness.js for the local test page. index.html at
the repo root is the compiled OUTPUT of this script, not something to edit
by hand: a change made there is lost the next time this runs.
"""
import io, json, re, time, os

HERE = os.path.dirname(os.path.abspath(__file__))   # src/
ROOT = os.path.dirname(HERE)                         # the repo root, one level up

def rd(p): return io.open(os.path.join(HERE, p), encoding="utf-8").read()
def rdroot(p): return io.open(os.path.join(ROOT, p), encoding="utf-8").read()
def wr(p, s): io.open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n").write(s)

# One id per build. It goes into the app, into version.json beside it, and into
# the service worker - so every release is noticed by open copies and installs
# fresh, with no version to remember to bump by hand.
build = time.strftime("%Y%m%d%H%M%S", time.gmtime())

head = rd("app-head.html").replace("</style>", rd("app-print.css") + "</style>", 1)
body = rd("app-body.html")
parts = ["app-js.js","app-views.js","home.js","app-sheets.js","quickadd.js","insights.js","arrivals.js","announce.js","pushnotify.js","outbox.js","updater.js","notifstack.js","app-boot.js"]
js   = "\n".join(rd(f) for f in parts)
assert js.count("__SETTLE_BUILD_ID__") == 1, "the build id placeholder must appear exactly once"
js   = js.replace("__SETTLE_BUILD_ID__", build)
out  = head + body + '\n<script src="firebase-config.js"></script>\n<script type="module">\n' + js + '\n</script>\n</body>\n</html>\n'
wr("index.html", out)
bad=[c for c in out if ord(c)<32 and c not in "\n\t"]
print("index.html", len(out.encode("utf-8")), "bytes | control chars", len(bad), "| build", build)

wr("version.json", json.dumps({"build": build}) + "\n")
sw = rdroot("sw.js")
sw2, n = re.subn(r"const VERSION = 'settle-[^']*';", "const VERSION = 'settle-" + build + "';", sw, count=1)
assert n == 1, "sw.js VERSION line not found"
wr("sw.js", sw2)
print("version.json and sw.js stamped")

hjs  = js + "\n" + rd("harness.js")
stub = ('<script>window.__NO_SW=1;window.FIREBASE_CONFIG={};window.ADMIN_EMAIL="abilashkjm01@gmail.com";'
        'window.PEOPLE_LINKS={"abilashkjm01@gmail.com":"Abilash"};</script>\n')
wr("_harness.html", head + body + "\n" + stub + '<script type="module">\n' + hjs + '\n</script>\n</body>\n</html>\n')
print("_harness.html written")
