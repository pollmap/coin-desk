import type { Asset } from './types';
/** Public project pages reviewed 2026-10-03. References, not independent risk ratings. */
export const ASSET_REFERENCES: Partial<
  Record<Asset, { provider: string; purpose: string; url: string }[]>
> = {
  BTC: [{ provider: 'Bitcoin.org', purpose: '프로토콜·발행 구조', url: 'https://bitcoin.org/en/' }],
  DOGE: [{ provider: 'Dogecoin', purpose: '프로젝트·네트워크 안내', url: 'https://dogecoin.com/' }],
  ETH: [
    {
      provider: 'Ethereum.org',
      purpose: 'ETH의 역할·발행과 소각',
      url: 'https://ethereum.org/what-is-ether/',
    },
  ],
  SOL: [{ provider: 'Solana', purpose: '프로젝트·기술 문서', url: 'https://solana.com/' }],
  XRP: [
    {
      provider: 'XRPL.org',
      purpose: '에스크로·잠금 해제 조건',
      url: 'https://xrpl.org/docs/concepts/payment-types/escrow',
    },
  ],
  LINK: [
    {
      provider: 'Chainlink',
      purpose: '유통량·토큰 배포 안내',
      url: 'https://chain.link/circulating-supply',
    },
  ],
  ONDO: [
    {
      provider: 'Ondo Foundation',
      purpose: '토큰 권리·배분·잠금 구조',
      url: 'https://docs.ondo.foundation/ondo-token',
    },
    {
      provider: 'Ondo Foundation',
      purpose: '잠금 해제 제안 원문·발표 당시 조건',
      url: 'https://blog.ondo.foundation/unlocking-ondo-a-proposal-from-the-ondo-foundation/',
    },
  ],
  PEPE: [
    { provider: 'PEPE 프로젝트', purpose: '토큰 구조·면책 설명', url: 'https://www.pepe.vip/' },
  ],
};
