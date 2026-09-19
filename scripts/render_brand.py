"""Render our native vector-style mark at browser icon sizes; no external image input."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/brand'
OUT.mkdir(exist_ok=True, parents=True)

def mark(size):
    scale = size * 4 / 64
    image = Image.new('RGBA', (size * 4, size * 4))
    draw = ImageDraw.Draw(image)
    def box(coords): return tuple(round(v * scale) for v in coords)
    draw.rounded_rectangle(box((0, 0, 64, 64)), radius=round(18*scale), fill='#101923')
    gold, teal = '#F2BA72', '#70D4C4'
    draw.arc(box((10, 14, 46, 50)), 90, 270, fill=gold, width=round(6*scale))
    for coords in [(28,17,45,17),(28,47,45,47)]:
        draw.line(box(coords),fill=gold,width=round(6*scale))
    for x,y in [(45,17),(45,47)]:
        draw.ellipse(box((x-3,y-3,x+3,y+3)),fill=gold)
    for x,y in [(28,29),(37,23),(46,28)]:
        draw.rounded_rectangle(box((x-2.5,y-2.5,x+2.5,40.5)),radius=round(2.5*scale),fill=teal)
    return image.resize((size,size),Image.Resampling.LANCZOS)

for size,name in [(32,'favicon-32.png'),(180,'apple-touch-icon.png'),(192,'icon-192.png'),(512,'icon-512.png')]:
    mark(size).save(OUT/name,optimize=True)
mark(64).save(ROOT/'public/favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])
print('Rendered Coin Desk native mark icons (32/180/192/512 PNG, multi-size ICO)')
