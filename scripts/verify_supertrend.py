"""Decimal reference calculated independently of the TypeScript implementation.
--write regenerates deterministic synthetic fixtures; default checks reproducibility.
"""
import argparse, decimal, json, pathlib
D = decimal.Decimal
decimal.getcontext().prec = 45
ROOT = pathlib.Path(__file__).resolve().parents[1]

def reference(bars, period=10, multiplier=3):
    true_ranges = [max(D(str(b['high']))-D(str(b['low'])),
                       abs(D(str(b['high']))-D(str(bars[i-1]['close']))) if i else D(0),
                       abs(D(str(b['low']))-D(str(bars[i-1]['close']))) if i else D(0))
                   for i, b in enumerate(bars)]
    if len(bars) < period: return []
    atr = sum(true_ranges[:period], D(0)) / period
    previous = None
    rows = []
    for i in range(period-1, len(bars)):
        if i >= period: atr = (atr*(period-1)+true_ranges[i])/period
        b = bars[i]; h, l, close = (D(str(b[k])) for k in ['high','low','close'])
        midpoint = (h+l)/2
        upper, lower = midpoint+D(str(multiplier))*atr, midpoint-D(str(multiplier))*atr
        if previous:
            prev_close = D(str(bars[i-1]['close']))
            if not (upper < previous['upper'] or prev_close > previous['upper']): upper = previous['upper']
            if not (lower > previous['lower'] or prev_close < previous['lower']): lower = previous['lower']
            if previous['value'] == previous['upper']: up = close > upper
            else: up = close >= lower
        else: lower = max(D(0),lower); up = False
        previous = dict(upper=upper,lower=lower,value=lower if up else upper)
        rows.append(dict(time=b['time'],atr=float(atr),upper=float(upper),lower=float(lower),value=float(previous['value']),direction='up' if up else 'down'))
    return rows

def fixtures():
    start=1704067200
    bars=[]
    previous=D('100')
    for i in range(100):
        close = D('100')+D((i%40) if i%80<40 else 40-i%40)*D('1.7')+D((i*11)%7)/10
        if 63 <= i < 70: close -= D('42')
        opening=previous
        bars.append(dict(time=start+i*86400,open=float(opening),high=float(max(opening,close)+D('1.2')),low=float(min(opening,close)-D('0.8')),close=float(close),volume=10,closeTime=start+(i+1)*86400,closed=True))
        previous=close
    return dict(kind='synthetic-independent-decimal-reference',bars=bars,cases=[dict(period=n,multiplier=k,expected=reference(bars,n,k)) for n,k in [(10,3),(7,2.5),(2,0.5)]])

def main():
    p=argparse.ArgumentParser();p.add_argument('--write',action='store_true');args=p.parse_args()
    data=fixtures();path=ROOT/'tests/fixtures/supertrend-reference.json'
    if args.write:path.write_text(json.dumps(data,separators=(',',':'))+'\n',encoding='utf-8')
    else:assert json.loads(path.read_text(encoding='utf-8'))==data,'Supertrend reference changed'
    print('100 synthetic OHLC bars; 3 independent Decimal Supertrend references verified')
if __name__=='__main__':main()
