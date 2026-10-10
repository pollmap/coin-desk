import { ASSET_REGISTRY_REVIEWED, assetDefinition } from './asset-registry';
import { ASSETS } from './catalog';
import { defaultIndicator, indicatorDefinition } from './indicator-catalog';
import type { Asset } from './types';

export const KNOWLEDGE_VERSION = '1.1.0';
export const KNOWLEDGE_REVIEWED = '2026-10-09';
export interface Evidence {
  url: string;
  provider: string;
  checkedAt: string;
  review: 'reviewed' | 'pending' | 'rejected';
  basis: 'official' | 'editorial' | 'implementation';
  note: string;
}
export interface KnowledgeNode {
  id: string;
  kind: 'asset' | 'project' | 'network' | 'theme' | 'indicator' | 'provider';
  label: string;
  description: string;
  evidence: Evidence;
  metric?: string;
}
export type KnowledgeRelation =
  | 'native-asset'
  | 'issued-on'
  | 'project-token'
  | 'theme'
  | 'measurement'
  | 'data-provider'
  | 'calculation-input';
export interface KnowledgeEdge {
  relation: KnowledgeRelation;
  id: string;
  source: string;
  target: string;
  label: string;
  evidence: Evidence;
}
export interface KnowledgeResponse {
  version: string;
  asset: Asset;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}
export const evidence = (
  url: string,
  provider: string,
  note: string,
  basis: Evidence['basis'] = 'official',
  checkedAt = KNOWLEDGE_REVIEWED,
  review: Evidence['review'] = 'reviewed',
): Evidence => ({
  url,
  provider,
  note,
  basis,
  checkedAt,
  review,
});
const facts: Partial<
  Record<
    Asset,
    {
      checkedAt: string;
      url: string;
      provider: string;
      note: string;
      network?: string;
      networkUrl?: string;
      project?: string;
      projectDescription?: string;
    }
  >
> = {
  BTC: {
    checkedAt: '2026-10-09',
    url: 'https://bitcoin.org/en/bitcoin-for-individuals',
    provider: 'Bitcoin.org',
    note: 'Bitcoin 네트워크에서 직접 전송하는 자산입니다.',
    network: 'Bitcoin',
  },
  DOGE: {
    checkedAt: '2026-10-09',
    url: 'https://dogecoin.com/dogepedia/articles/what-is-dogecoin/',
    provider: 'Dogecoin',
    note: '밈에서 출발한 Dogecoin 네트워크의 결제 자산입니다.',
    network: 'Dogecoin',
  },
  ETH: {
    checkedAt: '2026-10-09',
    url: 'https://ethereum.org/what-is-ether/',
    provider: 'Ethereum.org',
    note: 'Ethereum 수수료와 스테이킹에 사용하는 네이티브 자산입니다.',
    network: 'Ethereum',
  },
  SOL: {
    checkedAt: '2026-10-09',
    url: 'https://solana.com/docs/core/fees',
    provider: 'Solana',
    note: 'Solana 네트워크의 거래 수수료는 SOL로 지불합니다.',
    network: 'Solana',
  },
  XRP: {
    checkedAt: '2026-10-09',
    url: 'https://xrpl.org/about/xrp',
    provider: 'XRP Ledger',
    note: 'XRP Ledger의 네이티브 자산이며 Ripple 회사의 주식이 아닙니다.',
    network: 'XRP Ledger',
  },
  LINK: {
    checkedAt: '2026-10-09',
    url: 'https://docs.chain.link/resources/link-token-contracts',
    provider: 'Chainlink',
    note: '오라클 서비스와 네트워크 보안에 사용하는 Chainlink 토큰입니다.',
    project: 'Chainlink',
    projectDescription: '블록체인과 외부 데이터를 연결하는 오라클 프로젝트입니다.',
    network: 'Ethereum',
    networkUrl: 'https://docs.chain.link/resources/link-token-contracts',
  },
  ONDO: {
    checkedAt: '2026-10-09',
    url: 'https://docs.ondo.foundation/ondo-token',
    provider: 'Ondo Foundation',
    note: 'Ondo DAO의 거버넌스 토큰입니다. 국채나 이자 수익청구권이 아닙니다.',
    project: 'Ondo DAO',
    projectDescription: 'ONDO 보유자가 거버넌스에 참여하는 DAO입니다.',
  },
  PEPE: {
    checkedAt: '2026-10-09',
    url: 'https://www.pepe.vip/',
    provider: 'Pepe',
    note: '프로젝트가 밈 토큰으로 설명하는 Ethereum 토큰입니다.',
    project: 'Pepe',
    projectDescription: 'PEPE 밈 토큰의 프로젝트입니다.',
    network: 'Ethereum',
  },
  PENGU: {
    checkedAt: '2026-10-09',
    url: 'https://www.binance.com/en/academy/articles/what-are-pudgy-penguins-pengu',
    provider: 'Binance Academy',
    note: 'Pudgy Penguins 생태계의 커뮤니티 토큰입니다. NFT 자체와 구분합니다.',
    project: 'Pudgy Penguins',
    projectDescription: '펭귄 캐릭터 NFT와 상품·콘텐츠를 전개하는 프로젝트입니다.',
  },
  ADA: {
    checkedAt: '2026-10-09',
    url: 'https://cardano.org/what-is-ada/',
    provider: 'Cardano',
    note: 'Cardano 네트워크에서 전송과 스테이킹에 사용하는 네이티브 자산입니다.',
    network: 'Cardano',
  },
  AAVE: {
    checkedAt: '2026-10-09',
    url: 'https://www.aave.com/docs/ecosystem/aave',
    provider: 'Aave',
    note: '대출 프로토콜 Aave의 거버넌스 토큰입니다. 예치 자산이나 대출 잔액과 구분합니다.',
    project: 'Aave',
    projectDescription: '암호자산을 예치하거나 담보로 대출하는 프로토콜입니다.',
    network: 'Ethereum',
  },
  SHIB: {
    checkedAt: '2026-10-09',
    url: 'https://shib.io/developers',
    provider: 'Shiba Inu',
    note: 'Shiba Inu 생태계의 토큰입니다. 이 화면의 온체인 지표는 Ethereum의 SHIB를 측정합니다.',
    project: 'Shiba Inu',
    projectDescription: 'SHIB와 Shibarium 등으로 구성된 생태계입니다.',
    network: 'Ethereum',
  },
  SUI: {
    checkedAt: '2026-10-09',
    url: 'https://docs.sui.io/develop/sui-architecture',
    provider: 'Sui',
    note: 'Sui 네트워크에서 가스 비용과 스테이킹에 사용하는 네이티브 자산입니다.',
    network: 'Sui',
  },
};
export interface ThemeDefinition {
  id: string;
  title: string;
  description: string;
  members: { asset: Asset; evidence: Evidence }[];
}
const theme = (
  id: string,
  title: string,
  description: string,
  assets: Asset[],
): ThemeDefinition => ({
  id,
  title,
  description,
  members: assets.map((asset) => ({
    asset,
    evidence: evidence(
      facts[asset]!.url,
      facts[asset]!.provider,
      facts[asset]!.note + ' 이 테마 연결은 보리차트의 편집 분류입니다.',
      'editorial',
      facts[asset]!.checkedAt,
    ),
  })),
});
export const THEMES: ThemeDefinition[] = [
  theme('payments', '통화·결제', '네트워크에서 가치를 전송하는 자산', ['BTC', 'DOGE', 'XRP']),
  theme('platforms', '스마트계약 플랫폼', '앱 실행과 네트워크 수수료에 사용하는 자산', [
    'ETH',
    'SOL',
    'ADA',
    'SUI',
  ]),
  theme('memes', '밈·커뮤니티', '밈과 커뮤니티를 중심으로 알려진 코인·토큰', [
    'DOGE',
    'PEPE',
    'SHIB',
    'PENGU',
  ]),
  theme('oracles', '오라클', '블록체인과 외부 데이터의 연결', ['LINK']),
  theme('rwa', 'RWA 관련', '실물자산 토큰화 프로젝트와 관련된 거버넌스 토큰', ['ONDO']),
  theme('defi', '디파이', '블록체인 금융 프로토콜과 관련된 토큰', ['AAVE']),
];
export const themesResponse = () => ({
  version: KNOWLEDGE_VERSION,
  scope: '보리차트 추적 종목 기준',
  editorial: true,
  themes: THEMES,
});
const implementation = 'https://github.com/pollmap/coin-desk/blob/main/shared/indicator-catalog.ts';
export function assetKnowledge(asset: Asset): KnowledgeResponse {
  const fact = facts[asset] ?? {
      checkedAt: ASSET_REGISTRY_REVIEWED,
      url: assetDefinition(asset)!.review.sources[0],
      provider: '거래소 종목 정보',
      note: '거래소에서 확인한 자산입니다. 프로젝트·네트워크 관계는 검토 중입니다.',
    },
    root = 'asset:' + asset;
  const proof = evidence(
    fact.url,
    fact.provider,
    fact.note,
    'official',
    fact.checkedAt,
    facts[asset] ? 'reviewed' : 'pending',
  );
  const nodes: KnowledgeNode[] = [
    {
      id: root,
      kind: 'asset',
      label: ASSETS.find((a) => a.id === asset)!.name + ' · ' + asset,
      description: fact.note,
      evidence: proof,
    },
  ];
  const edges: KnowledgeEdge[] = [];
  const add = (node: KnowledgeNode, label: string, source = root) => {
    nodes.push(node);
    edges.push({
      id: source + '->' + node.id,
      source,
      target: node.id,
      label,
      relation:
        (
          {
            '프로젝트의 토큰': 'project-token',
            '발행 네트워크': 'issued-on',
            '네이티브 자산': 'native-asset',
            '관련 테마': 'theme',
            '확인할 지표': 'measurement',
            '사용하는 원천': 'data-provider',
          } as Record<string, KnowledgeRelation>
        )[label] ?? 'calculation-input',
      evidence: node.evidence,
    });
  };
  if (fact.project)
    add(
      {
        id: 'project:' + asset,
        kind: 'project',
        label: fact.project,
        description: fact.projectDescription!,
        evidence: proof,
      },
      '프로젝트의 토큰',
    );
  if (fact.network)
    add(
      {
        id: 'network:' + fact.network,
        kind: 'network',
        label: fact.network,
        description: ['LINK', 'PEPE', 'AAVE', 'SHIB'].includes(asset)
          ? '확인한 발행 네트워크입니다. 다른 체인의 배포 전체 목록은 아닙니다.'
          : `${asset}를 네이티브 자산으로 사용하는 네트워크입니다.`,
        evidence: evidence(
          fact.networkUrl ?? fact.url,
          fact.provider,
          fact.note,
          'official',
          fact.checkedAt,
        ),
      },
      ['LINK', 'PEPE', 'AAVE', 'SHIB'].includes(asset) ? '발행 네트워크' : '네이티브 자산',
    );
  for (const theme of THEMES) {
    const member = theme.members.find((m) => m.asset === asset);
    if (member)
      add(
        {
          id: 'theme:' + theme.id,
          kind: 'theme',
          label: theme.title,
          description: theme.description,
          evidence: member.evidence,
        },
        '관련 테마',
      );
  }
  const metric = defaultIndicator(asset),
    definition = indicatorDefinition(metric)!;
  const metricEvidence = evidence(
    implementation,
    '보리차트 계산·지원 카탈로그',
    definition.shortMeaning + ' 지원 정의이며 현재 수집 성공 여부와는 별개입니다.',
    'implementation',
  );
  add(
    {
      id: 'indicator:' + metric,
      kind: 'indicator',
      label: definition.title,
      metric,
      description: definition.shortMeaning,
      evidence: metricEvidence,
    },
    '확인할 지표',
  );
  add(
    {
      id: 'provider:' + definition.source,
      kind: 'provider',
      label: definition.source,
      description: '선택 지표의 원천입니다. 현재 관측일과 지연은 차트에서 확인합니다.',
      evidence: metricEvidence,
    },
    '사용하는 원천',
    'indicator:' + metric,
  );
  return { version: KNOWLEDGE_VERSION, asset, nodes, edges };
}
