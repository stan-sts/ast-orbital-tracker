#!/usr/bin/env python3
"""Rebuild index.html for the AST Orbital Tracker.

Fetches the latest TLEs from Celestrak for the real on-orbit AST fleet, embeds
them (plus the Earth textures and JS libraries) into a single self-contained,
pure-ASCII HTML file. Run by .github/workflows/refresh.yml on a daily schedule.
"""
import base64, json, os, ssl, sys, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
def P(*a): return os.path.join(ROOT, *a)

# Real NORAD catalog IDs for the on-orbit AST SpaceMobile fleet (BlueBird 7 is
# lost / has no valid orbit, so it is intentionally absent here).
FLEET_IDS = ['53807', '61045', '61046', '61047', '61048', '61049',
             '67232', '69589', '69590', '69591']

def fetch_tles(prev):
    """Return {catnr: [line1, line2]}. Falls back to the previous snapshot for
    any satellite whose fetch fails, so the site never regresses to empty."""
    ctx = ssl.create_default_context()
    out = {}
    for cid in FLEET_IDS:
        url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={cid}&FORMAT=TLE"
        try:
            txt = urllib.request.urlopen(url, timeout=30, context=ctx).read().decode().strip()
            lines = [l.rstrip() for l in txt.splitlines()]
            l1 = next(l for l in lines if l.startswith('1 '))
            l2 = next(l for l in lines if l.startswith('2 '))
            out[cid] = [l1, l2]
        except Exception as e:
            print(f"WARN: fetch {cid} failed: {e}", file=sys.stderr)
            if cid in prev:
                out[cid] = prev[cid]
                print(f"  -> kept previous elements for {cid}", file=sys.stderr)
    return out

def esc_html(s): return ''.join(c if ord(c) < 128 else "&#%d;" % ord(c) for c in s)
def esc_js(s):   return ''.join(c if ord(c) < 128 else "\\u%04x" % ord(c) for c in s)
def datauri(path, mime):
    return f"data:{mime};base64," + base64.b64encode(open(path, 'rb').read()).decode()

def main():
    prev = {}
    if os.path.exists(P('live_tles.json')):
        try: prev = json.load(open(P('live_tles.json')))
        except Exception: prev = {}

    tles = fetch_tles(prev)
    if not tles:
        print("ERROR: no TLEs fetched and no fallback available; aborting.", file=sys.stderr)
        sys.exit(1)
    json.dump(tles, open(P('live_tles.json'), 'w'), indent=0, sort_keys=True)

    TEX = {
        "day":    datauri(P('tex', 'earth_atmos_2048.jpg'),    "image/jpeg"),
        "spec":   datauri(P('tex', 'earth_specular_2048.jpg'), "image/jpeg"),
        "normal": datauri(P('tex', 'earth_normal_2048.jpg'),   "image/jpeg"),
        "clouds": datauri(P('tex', 'earth_clouds_1024.png'),   "image/png"),
    }

    app = open(P('src', 'app.js'), encoding='utf-8').read()
    app = app.replace('/*__LIVE_TLES__*/ {}', json.dumps(tles)).replace('/*__TEX__*/ {}', json.dumps(TEX))
    app = esc_js(app)

    shell = esc_html(open(P('src', 'shell.html'), encoding='utf-8').read())
    if '<meta charset' not in shell:
        shell = '<meta charset="utf-8">\n' + shell

    three = open(P('vendor', 'three.min.js')).read()
    orbit = open(P('vendor', 'OrbitControls.js')).read()
    sat   = open(P('vendor', 'satellite.min.js')).read()
    scripts = (f"<script>\n{three}\n</script>\n<script>\n{orbit}\n</script>\n"
               f"<script>\n{sat}\n</script>\n<script>\n{app}\n</script>\n")
    out = shell.replace('<!--__SCRIPTS__-->', scripts)

    open(P('index.html'), 'wb').write(out.encode('ascii'))
    print(f"built index.html: {len(out)} bytes, {len(tles)}/{len(FLEET_IDS)} live element sets")

if __name__ == '__main__':
    main()
