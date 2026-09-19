"""Validate actual icons, share metadata and optionally the deployed response bytes."""
import argparse, hashlib, json, pathlib, struct, urllib.request, xml.etree.ElementTree as ET
from html.parser import HTMLParser

root = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--base')
args = parser.parse_args()
class Metadata(HTMLParser):
    def __init__(self): super().__init__(); self.meta = {}; self.links = []
    def handle_starttag(self, tag, attrs):
        row = dict(attrs)
        if tag == 'meta': self.meta[row.get('property', row.get('name', ''))] = row.get('content')
        if tag == 'link': self.links.append(row)
doc = Metadata(); doc.feed((root/'index.html').read_text(encoding='utf-8'))
manifest = json.loads((root/'public/site.webmanifest').read_text(encoding='utf-8'))
assert manifest['name'].startswith('Coin Desk')
sizes = {'favicon-32.png': (32,32), 'apple-touch-icon.png': (180,180), 'icon-192.png': (192,192), 'icon-512.png': (512,512), 'og-card-v1.png': (1733,907)}
for name, expected in sizes.items():
    data = (root/'public/brand'/name).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', data[16:24]) == expected, name
for name in ['coin-desk-mark.svg','coin-desk-wordmark.svg']:
    assert ET.fromstring((root/'public/brand'/name).read_text(encoding='utf-8')).tag.endswith('svg')
ico = (root/'public/favicon.ico').read_bytes()
assert struct.unpack('<HHH',ico[:6]) == (0,1,4)
assert doc.meta['og:image'] == 'https://coin-desk.pages.dev/brand/og-card-v1.png'
assert doc.meta['twitter:card'] == 'summary_large_image'
assert (int(doc.meta['og:image:width']), int(doc.meta['og:image:height'])) == sizes['og-card-v1.png']
assert any(item.get('rel') == 'icon' and item.get('type') == 'image/svg+xml' for item in doc.links)
for icon in manifest['icons']:
    assert (root/'public'/icon['src'].lstrip('/')).is_file()
if args.base:
    def fetch(path):
        req = urllib.request.Request(args.base.rstrip('/')+path, headers={'User-Agent':'BTCDesk-Healthcheck/0.5'})
        with urllib.request.urlopen(req,timeout=25) as response: return response.read(), response.headers.get_content_type()
    live = Metadata(); live.feed(fetch('/metrics/mvrv')[0].decode())
    assert live.meta['og:image'] == doc.meta['og:image']
    for path in (root/'public').rglob('*'):
        if not path.is_file(): continue
        data, mime = fetch('/'+path.relative_to(root/'public').as_posix())
        assert hashlib.sha256(data).digest() == hashlib.sha256(path.read_bytes()).digest(), path.name
        assert mime != 'text/html', (path.name,mime)
print('Brand SVG/PNG/ICO dimensions, manifest, share metadata' + (' and public asset hashes' if args.base else '') + ' verified')
