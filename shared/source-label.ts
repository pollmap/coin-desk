export function sourceLabel(key: string) {
  if (key === 'automation') return '서버 자동 갱신';
  if (key === 'bitview') return 'BTC 온체인 · Bitview';
  if (key === 'coinlore') return '코인 시가총액 · CoinLore';
  if (key === 'defillama') return '스테이블코인 · DefiLlama';
  if (key === 'maintenance') return '이력 정리';
  if (key === 'mempool:BTC') return 'BTC 수수료·미확인 거래 · mempool.space';
  if (key.startsWith('derivatives:')) {
    const [, asset, metric] = key.split(':');
    const labels: Record<string, string> = {
      funding: '펀딩비',
      open_interest: '미결제약정',
      long_account_ratio: '롱 계정 비율',
      funding_daily: '일별 펀딩비',
      open_interest_daily: '일별 미결제약정',
      long_account_ratio_daily: '일별 롱 계정 비율',
    };
    return asset + ' · Bybit ' + (labels[metric] || metric);
  }
  if (key.startsWith('network:')) return key.split(':')[1] + ' 온체인 · Coin Metrics';
  if (key.startsWith('reference:')) return key.split(':')[1] + ' 장기 USD · Coin Metrics';
  if (key.startsWith('quote:')) {
    const [, asset, market] = key.split(':');
    return asset + ' · ' + (market === 'binance' ? 'Binance' : 'Upbit') + ' 현재가';
  }
  if (key.startsWith('quotes:')) {
    const [, market, batch] = key.split(':');
    return (market === 'binance' ? 'Binance' : 'Upbit') + ' 시세 묶음 ' + (Number(batch) + 1);
  }
  const [asset, market, interval] = key.split(':');
  return market
    ? asset +
        ' · ' +
        (market === 'binance' ? 'Binance' : 'Upbit') +
        ' ' +
        (interval === '1h' ? '시간봉' : '일봉')
    : key;
}
