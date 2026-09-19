import { createServer } from 'vite';
import { openDatabase } from './local-db.mjs';
const DB = openDatabase();
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
const env = {
  DB,
  ENABLED_ASSETS: 'BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE',
  BITVIEW_BASE_URL: 'https://bitview.space',
};
try {
  const { updatePrice, updateOnchain } = await server.ssrLoadModule('/worker/scheduled.ts');
  for (const market of ['binance', 'upbit'])
    for (const interval of ['1h', '1d']) {
      await updatePrice(env, 'BTC', market, interval);
      console.log('Updated BTC', market, interval);
    }
  await updateOnchain(env);
  console.log('Updated Bitview closed observations');
} finally {
  await server.close();
  DB.sqlite.close();
}
