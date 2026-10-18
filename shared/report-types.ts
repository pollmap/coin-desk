/** Public, deterministic research reports. Never includes personal workspaces or credentials. */
export type ReportScope = 'global' | 'injective';
export type ReportType = 'daily' | 'weekly';
export type ResearchQuality = 'complete' | 'partial';
export type ResearchState = 'ready' | 'pending' | 'disabled' | 'unavailable';
export interface ReportEvidence {
  id: string;
  entityId: string;
  entityType: 'global' | 'token' | 'chain' | 'market';
  metric: string;
  value: string | null;
  unit: string;
  source: string;
  sourceUrl: string;
  scope: string;
  dataAsOf: string | null;
  fetchedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: 'verified' | 'partial' | 'unavailable';
  calculationVersion: string;
  contentHash: string;
}
export interface ReportFact {
  label: string;
  value: string | null;
  unit: string;
  evidenceIds: string[];
  note?: string;
  href?: string;
}
export type ReportSection =
  | { kind: 'facts'; title: string; items: ReportFact[] }
  | { kind: 'table'; title: string; rows: { label: string; href?: string; facts: ReportFact[] }[] }
  | { kind: 'note'; title: string; text: string };
export interface ReportSummary {
  reportId: string;
  reportType: ReportType;
  scopeId: ReportScope;
  title: string;
  periodStart: string;
  periodEnd: string;
  publishedAt: string;
  revision: number;
  publicationStatus: 'published' | 'superseded';
  dataQuality: ResearchQuality;
  highlights: string[];
}
export interface PublishedReport extends ReportSummary {
  dataCutoff: string;
  generatedAt: string;
  supersedesReportId: string | null;
  supersededByReportId: string | null;
  sections: ReportSection[];
  evidence: ReportEvidence[];
  coverageNotes: string[];
  methodologyVersion: string;
  templateVersion: string;
  schemaVersion: 1;
  evidenceHash: string;
}
export interface ReportsResponse {
  data: ReportSummary[];
  nextCursor: string | null;
  status: ResearchState;
  schedule: { timezone: 'Asia/Seoul'; daily: '09:10'; weekly: '월요일 09:20' };
}
export interface LatestReportResponse {
  data: ReportSummary | null;
  status: ResearchState;
}
export interface ReportDetailResponse {
  data: PublishedReport;
}
export interface ResearchMarket {
  id: string;
  chain: 'injective';
  network: 'mainnet';
  venue: 'injective';
  kind: 'spot' | 'perpetual' | 'expiry_future' | 'other_derivative';
  ticker: string;
  baseDenom: string | null;
  quoteDenom: string;
  quoteSymbol: string;
  baseDecimals: number | null;
  quoteDecimals: number;
  status: string;
  sourceUrl: string;
  verifiedAt: string;
}
export interface ResearchCoverage {
  scope: ReportScope;
  state: ResearchState;
  providers: {
    provider: string;
    scope: string;
    lastSuccess: string | null;
    dataAsOf: string | null;
    errorCode: string | null;
  }[];
  marketCount: number;
  series: {
    entityId: string;
    metric: string;
    unit: string;
    first: string;
    last: string;
    observations: number;
  }[];
}
