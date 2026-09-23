"""Reproducible native vector identity, icons and a 1200x630 social card."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/brand'
OUT.mkdir(exist_ok=True, parents=True)
TEAL, INK, WHITE = '#51dac2', '#0b1014', '#e5edf3'
C = [(48,15),(40,9),(23,9),(11,21),(11,43),(23,55),(50,55)]
TRACE = [(26,38),(33,29),(41,34),(54,21)]

def mark(size):
    scale = size*4/64
    im = Image.new('RGBA',(size*4,size*4))
    draw = ImageDraw.Draw(im)
    pts = lambda points: [(round(x*scale),round(y*scale)) for x,y in points]
    draw.line(pts(C),fill=TEAL,width=max(1,round(6*scale)),joint='curve')
    draw.line(pts(TRACE),fill=WHITE,width=max(1,round(4*scale)),joint='curve')
    return im.resize((size,size),Image.Resampling.LANCZOS)

def svg_mark(trace=WHITE,accent=TEAL):
    return f'<path d="M48 15 40 9H23L11 21v22l12 12h27" fill="none" stroke="{accent}" stroke-width="6" stroke-linejoin="round"/><path d="m26 38 7-9 8 5 13-13" fill="none" stroke="{trace}" stroke-width="4" stroke-linejoin="round"/>'

for suffix,text,accent in [('',WHITE,TEAL),('-light',INK,'#087b69'),('-mono','currentColor','currentColor')]:
    (OUT/('coin-desk-mark'+suffix+'.svg')).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Coin Desk">{svg_mark(text,accent)}</svg>',encoding='utf-8')
    (OUT/('coin-desk-wordmark'+suffix+'.svg')).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 80" role="img" aria-label="Coin Desk"><g transform="translate(0 8)">{svg_mark(text,accent)}</g><text x="79" y="52" font-family="Segoe UI,Arial,sans-serif" font-size="38" font-weight="600" fill="{text}">Coin<tspan fill="{accent}"> Desk</tspan></text></svg>',encoding='utf-8')
for size,name in [(32,'favicon-32.png'),(180,'apple-touch-icon.png'),(192,'icon-192.png'),(512,'icon-512.png')]:
    im=Image.new('RGBA',(size,size),INK)
    im.alpha_composite(mark(round(size*.78)),(round(size*.11),round(size*.11)))
    im.save(OUT/name,optimize=True)
ico=Image.new('RGBA',(64,64),INK)
ico.alpha_composite(mark(56),(4,4))
ico.save(ROOT/'public/favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])

def font(size,korean=False):
    names=['C:/Windows/Fonts/malgun.ttf'] if korean else ['C:/Windows/Fonts/seguisb.ttf','C:/Windows/Fonts/segoeui.ttf']
    for name in names:
        if Path(name).exists():return ImageFont.truetype(name,size)
    return ImageFont.truetype('DejaVuSans.ttf',size)

og=Image.new('RGB',(1200,630),INK)
d=ImageDraw.Draw(og)
for x in range(720,1200,64):d.line((x,0,x,630),fill='#19272e')
for y in range(38,630,64):d.line((720,y,1200,y),fill='#19272e')
d.rectangle((64,62,68,104),fill=TEAL)
d.text((89,58),'COIN DESK / MARKET RESEARCH',font=font(24),fill=TEAL)
d.text((60,190),'Coin Desk',font=font(92),fill=WHITE)
d.text((65,326),'시장의 전체 흐름을 읽다',font=font(38,True),fill=WHITE)
d.text((66,407),'BTC  /  DOGE  /  ETH',font=font(26),fill='#a0aeba')
d.text((66,537),'coin-desk.pages.dev',font=font(22),fill='#a0aeba')
symbol=mark(300)
og.paste(symbol,(831,174),symbol)
og.save(OUT/'og-card-v2.png',optimize=True)
print('Coin Desk SVG variants, PNG/ICO icons and 1200x630 share card rendered.')
