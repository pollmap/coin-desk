# 여덟 코인 데이터 보유 이력

확인: 2026-10-08T17:30:43.396451+00:00 · 읽기 전용, DB 쓰기 0건.

배포 후 실제 SQLite 관측과 읽기 API를 대조했습니다. 내부 결측은 첫·마지막 관측 사이의 빈 간격이며 최초 이전·마지막 이후 이력을 포함하지 않습니다. 제공자의 전체 이력 확보를 의미하지 않습니다. 펀딩은 계약별 변동 주기이므로 고정 간격 결측을 계산하지 않습니다. 미지원 MVRV는 대체하지 않습니다. Coin Metrics 커버리지 인덱스 70개를 저장 관측과 대조했습니다.

| 코인 | 원천 | 지표 | 저장 단위 | 첫 관측 UTC | 마지막 UTC | 관측 수 | 내부 결측 |
|---|---|---|---|---|---|---:|---:|
| BTC | Bitview | price | USD | 2009-01-03 00:00 | 2026-10-07 00:00 | 6482 | 5 |
| BTC | Bitview | market_cap | USD | 2009-01-03 00:00 | 2026-10-07 00:00 | 6482 | 5 |
| BTC | Bitview | realized_cap | USD | 2009-01-03 00:00 | 2026-10-07 00:00 | 6482 | 5 |
| BTC | Bitview | realized_price | USD | 2009-01-03 00:00 | 2026-10-07 00:00 | 6482 | 5 |
| BTC | Bitview | sth_realized_price | USD | 2009-01-03 00:00 | 2026-10-07 00:00 | 6482 | 5 |
| BTC | Bitview | sopr_24h | ratio | 2009-01-03 00:00 | 2026-10-07 00:00 | 6482 | 5 |
| BTC | Bitview | mvrv | ratio | 2010-08-16 00:00 | 2026-10-07 00:00 | 5897 | 0 |
| BTC | Bitview | nupl | ratio | 2010-08-16 00:00 | 2026-10-07 00:00 | 5897 | 0 |
| BTC | Bitview | sth_mvrv | ratio | 2010-08-31 00:00 | 2026-10-07 00:00 | 5882 | 0 |
| BTC | Bitview | mvrv_source | ratio | 2010-09-26 00:00 | 2026-10-07 00:00 | 5856 | 0 |
| BTC | Bitview | nupl_source | ratio | 2010-09-26 00:00 | 2026-10-07 00:00 | 5856 | 0 |
| BTC | Bitview | lth_mvrv | ratio | 2011-03-25 00:00 | 2026-10-07 00:00 | 5676 | 0 |
| BTC | Bitview | mvrv_z | Z | 2011-08-15 00:00 | 2026-10-07 00:00 | 5533 | 0 |
| BTC | Coin Metrics Community | mvrv | 배 | 2010-07-18 00:00 | 2026-10-07 00:00 | 5926 | 0 |
| BTC | Coin Metrics Community | active_addresses | 주소 / 일 | 2009-01-03 00:00 | 2026-10-07 00:00 | 6487 | 0 |
| BTC | Coin Metrics Community | balance_addresses | 주소 | 2009-01-03 00:00 | 2026-10-07 00:00 | 6487 | 0 |
| BTC | Coin Metrics Community | transactions | 건 / 일 | 2009-01-03 00:00 | 2026-10-07 00:00 | 6487 | 0 |
| BTC | Coin Metrics Community | transfers | 건 / 일 | 2009-01-03 00:00 | 2026-10-07 00:00 | 6487 | 0 |
| BTC | Coin Metrics Community | supply | 자산 단위 | 2009-01-03 00:00 | 2026-10-07 00:00 | 6487 | 0 |
| BTC | Coin Metrics Community | market_cap | USD | 2010-07-18 00:00 | 2026-10-07 00:00 | 5926 | 0 |
| BTC | Coin Metrics Community | fees_native | 자산 단위 / 일 | 2009-01-03 00:00 | 2026-10-07 00:00 | 6487 | 0 |
| BTC | Coin Metrics Community | hashrate | TH/s | 2009-01-09 00:00 | 2026-10-07 00:00 | 6481 | 0 |
| BTC | Coin Metrics Community | blocks | 블록 / 일 | 2009-01-03 00:00 | 2026-10-07 00:00 | 6487 | 0 |
| BTC | Coin Metrics Community | issuance | 자산 단위 / 일 | 2009-01-09 00:00 | 2026-10-07 00:00 | 6481 | 0 |
| BTC | Coin Metrics Community | exchange_inflow | 자산 단위 / 일 | 2011-04-24 00:00 | 2026-10-07 00:00 | 5646 | 0 |
| BTC | Coin Metrics Community | exchange_outflow | 자산 단위 / 일 | 2011-04-24 00:00 | 2026-10-07 00:00 | 5646 | 0 |
| BTC | Coin Metrics Community | exchange_balance | 자산 단위 | 2011-04-24 00:00 | 2026-10-07 00:00 | 5646 | 0 |
| BTC | Coin Metrics Community | exchange_netflow | 자산 단위 / 일 | 2011-04-24 00:00 | 2026-10-07 00:00 | 5646 | 0 |
| BTC | Coin Metrics Community | realized_cap | USD | 2010-07-18 00:00 | 2026-10-07 00:00 | 5926 | 0 |
| BTC | Coin Metrics Community | realized_price | USD | 2010-07-18 00:00 | 2026-10-07 00:00 | 5926 | 0 |
| BTC | Coin Metrics Community | nupl | 비율 | 2010-07-18 00:00 | 2026-10-07 00:00 | 5926 | 0 |
| BTC | Coin Metrics USD reference | price | USD | 2010-07-18 00:00 | 2026-10-07 00:00 | 5926 | 0 |
| BTC | binance | OHLCV 1h | USDT | 2026-07-10 17:00 | 2026-10-08 16:00 | 2160 | 0 |
| BTC | binance | OHLCV 1d | USDT | 2017-08-17 00:00 | 2026-10-07 00:00 | 3339 | 0 |
| BTC | upbit | OHLCV 1h | KRW | 2026-07-10 17:00 | 2026-10-08 16:00 | 2160 | 0 |
| BTC | upbit | OHLCV 1d | KRW | 2017-09-25 00:00 | 2026-10-07 00:00 | 3300 | 0 |
| BTC | Bybit USDT perpetual | funding | % | 2020-03-25 16:00 | 2026-10-08 16:00 | 7165 | 미산정 |
| BTC | Bybit USDT perpetual | open_interest | BTC | 2026-08-24 13:00 | 2026-10-08 17:00 | 1085 | 0 |
| BTC | Bybit USDT perpetual | long_account_ratio | % | 2026-08-25 06:00 | 2026-10-08 17:00 | 1068 | 0 |
| BTC | Bybit USDT perpetual | open_interest_daily | BTC | 2020-08-05 00:00 | 2026-10-08 00:00 | 2256 | 0 |
| BTC | Bybit USDT perpetual | long_account_ratio_daily | % | 2020-08-05 00:00 | 2026-10-08 00:00 | 2255 | 1 |
| DOGE | Coin Metrics Community | mvrv | 배 | 2014-01-23 00:00 | 2026-10-07 00:00 | 4641 | 0 |
| DOGE | Coin Metrics Community | active_addresses | 주소 / 일 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | balance_addresses | 주소 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | transactions | 건 / 일 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | transfers | 건 / 일 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | supply | 자산 단위 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | market_cap | USD | 2014-01-23 00:00 | 2026-10-07 00:00 | 4641 | 0 |
| DOGE | Coin Metrics Community | fees_native | 자산 단위 / 일 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | hashrate | TH/s | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | blocks | 블록 / 일 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | issuance | 자산 단위 / 일 | 2013-12-08 00:00 | 2026-10-07 00:00 | 4687 | 0 |
| DOGE | Coin Metrics Community | realized_cap | USD | 2014-01-23 00:00 | 2026-10-07 00:00 | 4641 | 0 |
| DOGE | Coin Metrics Community | realized_price | USD | 2014-01-23 00:00 | 2026-10-07 00:00 | 4641 | 0 |
| DOGE | Coin Metrics Community | nupl | 비율 | 2014-01-23 00:00 | 2026-10-07 00:00 | 4641 | 0 |
| DOGE | Coin Metrics USD reference | price | USD | 2014-01-23 00:00 | 2026-10-07 00:00 | 4641 | 0 |
| DOGE | binance | OHLCV 1h | USDT | 2026-07-02 08:00 | 2026-10-08 16:00 | 2361 | 0 |
| DOGE | binance | OHLCV 1d | USDT | 2019-07-05 00:00 | 2026-10-07 00:00 | 2652 | 0 |
| DOGE | upbit | OHLCV 1h | KRW | 2026-07-02 08:00 | 2026-10-08 16:00 | 2357 | 4 |
| DOGE | upbit | OHLCV 1d | KRW | 2021-02-24 00:00 | 2026-10-07 00:00 | 2052 | 0 |
| DOGE | Bybit USDT perpetual | funding | % | 2021-06-02 16:00 | 2026-10-08 16:00 | 5863 | 미산정 |
| DOGE | Bybit USDT perpetual | open_interest | DOGE | 2026-08-24 14:00 | 2026-10-08 17:00 | 1084 | 0 |
| DOGE | Bybit USDT perpetual | long_account_ratio | % | 2026-08-25 06:00 | 2026-10-08 17:00 | 1068 | 0 |
| DOGE | Bybit USDT perpetual | open_interest_daily | DOGE | 2021-06-03 00:00 | 2026-10-08 00:00 | 1954 | 0 |
| DOGE | Bybit USDT perpetual | long_account_ratio_daily | % | 2021-06-03 00:00 | 2026-10-08 00:00 | 1953 | 1 |
| ETH | Coin Metrics Community | mvrv | 배 | 2015-08-08 00:00 | 2026-10-07 00:00 | 4079 | 0 |
| ETH | Coin Metrics Community | active_addresses | 주소 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | balance_addresses | 주소 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | transactions | 건 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | transfers | 건 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | supply | 자산 단위 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | market_cap | USD | 2015-08-08 00:00 | 2026-10-07 00:00 | 4079 | 0 |
| ETH | Coin Metrics Community | fees_native | 자산 단위 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | blocks | 블록 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | issuance | 자산 단위 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | exchange_inflow | 자산 단위 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | exchange_outflow | 자산 단위 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | exchange_balance | 자산 단위 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | exchange_netflow | 자산 단위 / 일 | 2015-07-30 00:00 | 2026-10-07 00:00 | 4088 | 0 |
| ETH | Coin Metrics Community | realized_cap | USD | 2015-08-08 00:00 | 2026-10-07 00:00 | 4079 | 0 |
| ETH | Coin Metrics Community | realized_price | USD | 2015-08-08 00:00 | 2026-10-07 00:00 | 4079 | 0 |
| ETH | Coin Metrics Community | nupl | 비율 | 2015-08-08 00:00 | 2026-10-07 00:00 | 4079 | 0 |
| ETH | Coin Metrics USD reference | price | USD | 2015-08-08 00:00 | 2026-10-07 00:00 | 4079 | 0 |
| ETH | binance | OHLCV 1h | USDT | 2026-07-02 08:00 | 2026-10-08 16:00 | 2361 | 0 |
| ETH | binance | OHLCV 1d | USDT | 2017-08-17 00:00 | 2026-10-07 00:00 | 3339 | 0 |
| ETH | upbit | OHLCV 1h | KRW | 2026-07-02 08:00 | 2026-10-08 16:00 | 2358 | 3 |
| ETH | upbit | OHLCV 1d | KRW | 2017-09-25 00:00 | 2026-10-07 00:00 | 3297 | 3 |
| ETH | Bybit USDT perpetual | funding | % | 2020-10-21 08:00 | 2026-10-08 16:00 | 6536 | 미산정 |
| ETH | Bybit USDT perpetual | open_interest | ETH | 2026-08-24 13:00 | 2026-10-08 17:00 | 1085 | 0 |
| ETH | Bybit USDT perpetual | long_account_ratio | % | 2026-08-25 06:00 | 2026-10-08 17:00 | 1068 | 0 |
| ETH | Bybit USDT perpetual | open_interest_daily | ETH | 2020-10-22 00:00 | 2026-10-08 00:00 | 2178 | 0 |
| ETH | Bybit USDT perpetual | long_account_ratio_daily | % | 2020-10-22 00:00 | 2026-10-08 00:00 | 2177 | 1 |
| SOL | Coin Metrics Community | mvrv | 미지원 | — | — | 0 | 미산정 |
| SOL | Coin Metrics USD reference | price | USD | — | — | 0 | 0 |
| SOL | binance | OHLCV 1h | USDT | 2026-07-02 08:00 | 2026-10-08 16:00 | 2361 | 0 |
| SOL | binance | OHLCV 1d | USDT | 2020-08-11 00:00 | 2026-10-07 00:00 | 2249 | 0 |
| SOL | upbit | OHLCV 1h | KRW | 2026-07-02 08:00 | 2026-10-08 16:00 | 2357 | 4 |
| SOL | upbit | OHLCV 1d | KRW | 2021-10-15 00:00 | 2026-10-07 00:00 | 1819 | 0 |
| SOL | Bybit USDT perpetual | funding | % | 2021-06-29 08:00 | 2026-10-08 08:00 | 6142 | 미산정 |
| SOL | Bybit USDT perpetual | open_interest | SOL | 2026-08-25 10:00 | 2026-10-08 15:00 | 1055 | 7 |
| SOL | Bybit USDT perpetual | long_account_ratio | % | 2026-08-25 10:00 | 2026-10-08 15:00 | 1055 | 7 |
| SOL | Bybit USDT perpetual | open_interest_daily | SOL | 2021-06-30 00:00 | 2026-10-08 00:00 | 1927 | 0 |
| SOL | Bybit USDT perpetual | long_account_ratio_daily | % | 2021-06-30 00:00 | 2026-10-08 00:00 | 1926 | 1 |
| XRP | Coin Metrics Community | mvrv | 배 | 2014-08-15 00:00 | 2026-10-07 00:00 | 4437 | 0 |
| XRP | Coin Metrics Community | active_addresses | 주소 / 일 | 2013-01-01 00:00 | 2026-10-07 00:00 | 5028 | 0 |
| XRP | Coin Metrics Community | balance_addresses | 주소 | 2013-01-01 00:00 | 2026-10-07 00:00 | 5028 | 0 |
| XRP | Coin Metrics Community | transactions | 건 / 일 | 2013-01-01 00:00 | 2026-10-07 00:00 | 5028 | 0 |
| XRP | Coin Metrics Community | transfers | 건 / 일 | 2013-01-01 00:00 | 2026-10-07 00:00 | 5028 | 0 |
| XRP | Coin Metrics Community | supply | 자산 단위 | 2013-01-01 00:00 | 2026-10-07 00:00 | 5028 | 0 |
| XRP | Coin Metrics Community | market_cap | USD | 2014-08-15 00:00 | 2026-10-07 00:00 | 4437 | 0 |
| XRP | Coin Metrics Community | fees_native | 자산 단위 / 일 | 2013-01-01 00:00 | 2026-10-07 00:00 | 5028 | 0 |
| XRP | Coin Metrics Community | realized_cap | USD | 2014-08-15 00:00 | 2026-10-07 00:00 | 4437 | 0 |
| XRP | Coin Metrics Community | realized_price | USD | 2014-08-15 00:00 | 2026-10-07 00:00 | 4437 | 0 |
| XRP | Coin Metrics Community | nupl | 비율 | 2014-08-15 00:00 | 2026-10-07 00:00 | 4437 | 0 |
| XRP | Coin Metrics USD reference | price | USD | 2014-08-15 00:00 | 2026-10-07 00:00 | 4437 | 0 |
| XRP | binance | OHLCV 1h | USDT | 2026-07-02 08:00 | 2026-10-08 16:00 | 2361 | 0 |
| XRP | binance | OHLCV 1d | USDT | 2018-05-04 00:00 | 2026-10-07 00:00 | 3079 | 0 |
| XRP | upbit | OHLCV 1h | KRW | 2026-07-02 08:00 | 2026-10-08 16:00 | 2358 | 3 |
| XRP | upbit | OHLCV 1d | KRW | 2017-09-25 00:00 | 2026-10-07 00:00 | 3297 | 3 |
| XRP | Bybit USDT perpetual | funding | % | 2021-05-13 16:00 | 2026-10-08 08:00 | 5922 | 미산정 |
| XRP | Bybit USDT perpetual | open_interest | XRP | 2026-08-26 04:00 | 2026-10-08 15:00 | 1037 | 7 |
| XRP | Bybit USDT perpetual | long_account_ratio | % | 2026-08-26 02:00 | 2026-10-08 14:00 | 1039 | 6 |
| XRP | Bybit USDT perpetual | open_interest_daily | XRP | 2021-05-14 00:00 | 2026-10-08 00:00 | 1974 | 0 |
| XRP | Bybit USDT perpetual | long_account_ratio_daily | % | 2021-05-14 00:00 | 2026-10-08 00:00 | 1973 | 1 |
| LINK | Coin Metrics Community | mvrv | 배 | 2017-09-29 00:00 | 2026-10-07 00:00 | 3296 | 0 |
| LINK | Coin Metrics Community | active_addresses | 주소 / 일 | 2017-09-16 00:00 | 2026-10-07 00:00 | 3309 | 0 |
| LINK | Coin Metrics Community | balance_addresses | 주소 | 2017-09-16 00:00 | 2026-10-07 00:00 | 3309 | 0 |
| LINK | Coin Metrics Community | transactions | 건 / 일 | 2017-09-16 00:00 | 2026-10-07 00:00 | 3309 | 0 |
| LINK | Coin Metrics Community | transfers | 건 / 일 | 2017-09-16 00:00 | 2026-10-07 00:00 | 3309 | 0 |
| LINK | Coin Metrics Community | supply | 자산 단위 | 2017-09-16 00:00 | 2026-10-07 00:00 | 3309 | 0 |
| LINK | Coin Metrics Community | market_cap | USD | 2017-09-29 00:00 | 2026-10-07 00:00 | 3296 | 0 |
| LINK | Coin Metrics Community | realized_cap | USD | 2017-09-29 00:00 | 2026-10-07 00:00 | 3296 | 0 |
| LINK | Coin Metrics Community | realized_price | USD | 2017-09-29 00:00 | 2026-10-07 00:00 | 3296 | 0 |
| LINK | Coin Metrics Community | nupl | 비율 | 2017-09-29 00:00 | 2026-10-07 00:00 | 3296 | 0 |
| LINK | Coin Metrics USD reference | price | USD | 2017-09-29 00:00 | 2026-10-07 00:00 | 3296 | 0 |
| LINK | binance | OHLCV 1h | USDT | 2026-07-02 08:00 | 2026-10-08 16:00 | 2361 | 0 |
| LINK | binance | OHLCV 1d | USDT | 2019-01-16 00:00 | 2026-10-07 00:00 | 2822 | 0 |
| LINK | upbit | OHLCV 1h | KRW | 2026-07-02 08:00 | 2026-10-08 16:00 | 2357 | 4 |
| LINK | upbit | OHLCV 1d | KRW | 2020-08-04 00:00 | 2026-10-07 00:00 | 2256 | 0 |
| LINK | Bybit USDT perpetual | funding | % | 2020-10-21 08:00 | 2026-10-08 08:00 | 6535 | 미산정 |
| LINK | Bybit USDT perpetual | open_interest | LINK | 2026-08-26 02:00 | 2026-10-08 14:00 | 1039 | 6 |
| LINK | Bybit USDT perpetual | long_account_ratio | % | 2026-08-26 02:00 | 2026-10-08 14:00 | 1039 | 6 |
| LINK | Bybit USDT perpetual | open_interest_daily | LINK | 2020-10-22 00:00 | 2026-10-08 00:00 | 2178 | 0 |
| LINK | Bybit USDT perpetual | long_account_ratio_daily | % | 2020-10-22 00:00 | 2026-10-08 00:00 | 2177 | 1 |
| ONDO | Coin Metrics Community | mvrv | 미지원 | — | — | 0 | 미산정 |
| ONDO | Coin Metrics USD reference | price | USD | — | — | 0 | 0 |
| ONDO | binance | OHLCV 1h | USDT | 2026-07-02 08:00 | 2026-10-08 16:00 | 2361 | 0 |
| ONDO | binance | OHLCV 1d | USDT | 2025-04-11 00:00 | 2026-10-07 00:00 | 545 | 0 |
| ONDO | upbit | OHLCV 1h | KRW | 2026-07-02 08:00 | 2026-10-08 16:00 | 2357 | 4 |
| ONDO | upbit | OHLCV 1d | KRW | 2024-06-14 00:00 | 2026-10-07 00:00 | 846 | 0 |
| ONDO | Bybit USDT perpetual | funding | % | 2024-01-23 08:00 | 2026-10-08 12:00 | 4862 | 미산정 |
| ONDO | Bybit USDT perpetual | open_interest | ONDO | 2026-08-26 03:00 | 2026-10-08 15:00 | 1038 | 7 |
| ONDO | Bybit USDT perpetual | long_account_ratio | % | 2026-08-26 03:00 | 2026-10-08 15:00 | 1038 | 7 |
| ONDO | Bybit USDT perpetual | open_interest_daily | ONDO | 2024-01-24 00:00 | 2026-10-08 00:00 | 989 | 0 |
| ONDO | Bybit USDT perpetual | long_account_ratio_daily | % | 2024-01-24 00:00 | 2026-10-08 00:00 | 989 | 0 |
| PEPE | Coin Metrics Community | mvrv | 미지원 | — | — | 0 | 미산정 |
| PEPE | Coin Metrics USD reference | price | USD | — | — | 0 | 0 |
| PEPE | binance | OHLCV 1h | USDT | 2026-07-02 08:00 | 2026-10-08 16:00 | 2361 | 0 |
| PEPE | binance | OHLCV 1d | USDT | 2023-05-05 00:00 | 2026-10-07 00:00 | 1252 | 0 |
| PEPE | upbit | OHLCV 1h | KRW | 2026-07-02 08:00 | 2026-10-08 16:00 | 2357 | 4 |
| PEPE | upbit | OHLCV 1d | KRW | 2024-11-14 00:00 | 2026-10-07 00:00 | 693 | 0 |
| PEPE | Bybit USDT perpetual | funding | % | 2023-05-03 08:00 | 2026-10-08 08:00 | 3763 | 미산정 |
| PEPE | Bybit USDT perpetual | open_interest | PEPE (PEPE normalized from 1000PEPE) | 2026-08-26 03:00 | 2026-10-08 15:00 | 1038 | 7 |
| PEPE | Bybit USDT perpetual | long_account_ratio | % | 2026-08-26 03:00 | 2026-10-08 15:00 | 1038 | 7 |
| PEPE | Bybit USDT perpetual | open_interest_daily | PEPE (PEPE normalized from 1000PEPE) | 2023-05-04 00:00 | 2026-10-08 00:00 | 1254 | 0 |
| PEPE | Bybit USDT perpetual | long_account_ratio_daily | % | 2023-05-04 00:00 | 2026-10-08 00:00 | 1254 | 0 |

SOL·ONDO·PEPE의 MVRV와 Coin Metrics USD 참조가격은 미지원입니다. 실제 거래소 가격과 RSI 등 지원 분석만 제공합니다.

Upbit ETH·XRP 일봉의 2017-10-21~23은 원천 응답에서도 결측을 확인했습니다([대조 기록](historical-gap-check.json)). 시간봉은 최근 90일 확보 범위이며 그 이전의 빈 간격을 현재 복구의 완료 대상으로 주장하지 않습니다. 과거 결측은 보간하지 않았습니다.

Bybit open interest와 long account ratio의 감사 간격은 실제 수집 주기인 1시간입니다. PEPE 미결제약정은 1000PEPE 계약을 PEPE 수량으로 변환한 단위입니다.

수집 성공·원천 기준일·지원 여부·현재 이력 복구 상태는 별개입니다. [현재 운영 대조](public-after.json), [전체 보유 이력 JSON](data-inventory-after.json), [배포 전 이력](data-inventory-before.json)을 함께 확인합니다.
