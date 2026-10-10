"""Coverage of confirmed mutable and archived candles, with corrections winning.

Read-only. Launch dates are not inferred from trading observations. No missing
dates are filled, and archive/recent overlap is counted exactly once.
"""
import json
import time


def candle_coverage(database, now=None):
    now = int(time.time()) if now is None else now
    pairs = database.execute(
        'SELECT asset,market,interval FROM candles '
        'UNION SELECT asset,market,interval FROM price_archive ORDER BY 1,2,3'
    ).fetchall()
    result = []
    for asset, market, interval in pairs:
        points = {}
        for chunk, in database.execute(
            'SELECT data FROM price_archive WHERE asset=? AND market=? AND interval=? ORDER BY start',
            (asset, market, interval),
        ):
            for candle in json.loads(chunk):
                if candle[6] <= now:
                    points[candle[0]] = candle[4]
        for stamp, close, closes_at in database.execute(
            'SELECT time,close,close_time FROM candles WHERE asset=? AND market=? AND interval=?',
            (asset, market, interval),
        ):
            if closes_at <= now:
                points[stamp] = close
            else:
                points.pop(stamp, None)
        times = sorted(points)
        step = 3600 if interval == '1h' else 86400
        result.append({
            'asset': asset, 'market': market, 'interval': interval,
            'first': times[0] if times else None,
            'last': times[-1] if times else None,
            'observations': len(times),
            'missingSlots': sum(max(0, (b - a) // step - 1) for a, b in zip(times, times[1:])),
            'firstClose': points[times[0]] if times else None,
            'unit': 'KRW' if market == 'upbit' else 'USDT',
            'includesArchive': True,
            'confirmedOnly': True,
        })
    return result
