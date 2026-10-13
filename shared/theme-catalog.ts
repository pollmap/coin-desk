import manifest from './theme-classifications.json' with { type: 'json' };
import type { Evidence, ThemeDefinition } from './knowledge';
import type { Asset } from './types';

export interface ThemeClassification {
  asset: Asset;
  themes: string[];
  evidence: Evidence;
  providerClassification?: {
    level1Code: string;
    level1Name: string;
    level2Code: string;
    level2Name: string;
    level3Code: string;
    level3Name: string;
  };
}
export const THEME_CATALOG_VERSION = manifest.version;
export const THEME_CLASSIFICATIONS = manifest.records as ThemeClassification[];

const definitions: [string, string, string][] = [
  ['payments', '통화·결제', '디지털 통화와 결제 네트워크 관련 자산'],
  ['platforms', '스마트계약 플랫폼', '스마트계약 네트워크와 관련된 코인·토큰'],
  ['memes', '밈·커뮤니티', '밈과 인터넷 커뮤니티를 중심으로 알려진 자산'],
  ['oracles', '오라클', '블록체인과 외부 데이터를 연결하는 프로젝트'],
  ['rwa', 'RWA 관련', '실물 자산 토큰화와 관련된 프로젝트·토큰'],
  ['defi', '디파이', '온체인 금융 프로토콜과 관련된 자산'],
  ['infrastructure', '블록체인 인프라', '네트워크·데이터·개발 환경과 관련된 자산'],
  ['culture', '게임·콘텐츠', '게임·가상세계·콘텐츠 생태계와 관련된 자산'],
  ['ai', 'AI', '인공지능 개발·서비스와 관련된 프로젝트'],
  ['depin', '분산 자원', '분산 네트워크의 연산·저장·데이터 자원 관련 프로젝트'],
  ['data', '데이터', '데이터 소유·처리·제공과 관련된 프로젝트'],
  ['storage', '저장소', '분산 데이터 저장과 관련된 프로젝트'],
  ['interoperability', '상호운용·브릿지', '서로 다른 네트워크의 연결과 자산 이동'],
  ['identity', '디지털 신원', '블록체인 기반 신원과 인증 관련 프로젝트'],
  ['dex', '탈중앙 거래소', '온체인 교환·거래 프로토콜과 관련된 자산'],
  ['derivatives', '파생상품 거래', '무기한 계약·선물·옵션 프로토콜과 관련된 자산'],
  ['lending', '대출·렌딩', '예치·담보 대출·결제금융 프로젝트와 관련된 자산'],
  ['staking', '스테이킹', '스테이킹·유동화 스테이킹·리스테이킹 관련 프로젝트'],
  [
    'stablecoin-related',
    '스테이블코인 관련',
    '스테이블코인 프로젝트의 연관 자산. 토큰 자체의 가격 고정을 뜻하지 않음',
  ],
  ['nft-gaming', 'NFT·게임', 'NFT와 게임 생태계에 관련된 자산'],
  ['metaverse', '가상세계', '가상세계·메타버스 프로젝트와 관련된 자산'],
  ['advertising', '광고', '광고·콘텐츠 수익화와 관련된 프로젝트'],
  ['sports', '스포츠', '스포츠와 팬 참여 생태계에 관련된 자산'],
  ['wallets', '지갑', '소프트웨어·하드웨어 지갑 프로젝트의 연관 토큰'],
  ['privacy', '프라이버시', '기밀 거래·데이터 보호 기능과 관련된 프로젝트'],
  ['layer2', '레이어 2', '기반 네트워크를 확장하는 L2 프로젝트'],
  ['governance', 'DAO·거버넌스', '프로토콜 의사결정과 DAO 운영 관련 프로젝트'],
  ['exchange-token', '거래소 연관', '거래소와 관련해 발행된 토큰. 현재 거래소 운영 여부와는 별개'],
  ['cefi', '중앙화 금융', '중앙화 금융 플랫폼과 관련된 토큰'],
  ['bitcoin-ecosystem', '비트코인 생태계', 'Bitcoin 기반의 토큰·서비스. BTC 자체와 구분'],
  ['yield', '디파이 자산 운용', '온체인 자산 운용·유동성 관리 프로젝트. 수익을 보장하지 않음'],
];

/** Provider taxonomy is editorial evidence; it does not review a project's token rights. */
export const CLASSIFIED_THEMES: ThemeDefinition[] = definitions.map(([id, title, description]) => ({
  id,
  title,
  description,
  members: THEME_CLASSIFICATIONS.filter((record) => record.themes.includes(id)).map((record) => ({
    asset: record.asset,
    evidence: record.evidence,
  })),
}));

const classified = new Map(THEME_CLASSIFICATIONS.map((record) => [record.asset, record]));
export const assetThemeClassification = (asset: Asset) => classified.get(asset);
