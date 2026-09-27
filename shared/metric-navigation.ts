/** UI categories describe the question, independently of data provider. */
export function metricCategory(id: string) {
  if (id.startsWith('futures:')) return '선물 수급';
  if (id.startsWith('chain:')) return 'DeFi·유동성';
  if (/mvrv|realized|nupl|sopr|profit|loss|cost/.test(id)) return '가격 평가·손익';
  if (/hash|block|difficulty|issuance|miner/.test(id)) return '채굴·발행';
  if (/supply|holder|hodl|lth|sth/.test(id)) return '공급·보유';
  if (id.startsWith('net:') || id.startsWith('btc:')) return '네트워크 활동';
  return '가격·기술';
}

export const primaryShortcuts = {
  onchain: [
    ['net:mvrv', 'MVRV'],
    ['net:active_addresses', '활성 주소'],
    ['net:transactions', '거래 수'],
    ['net:realized_price', '실현가격'],
  ],
  futures: [
    ['futures:funding', '펀딩률'],
    ['futures:open_interest_daily', '미결제약정'],
    ['futures:long_account_ratio_daily', '롱 계정 비중'],
  ],
} as const;
