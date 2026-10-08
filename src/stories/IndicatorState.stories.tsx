import type { Meta, StoryObj } from '@storybook/react-vite';
import { IndicatorState } from '../IndicatorState';
const meta = { title: '보리차트/관측 상태', component: IndicatorState } satisfies Meta<
  typeof IndicatorState
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  args: { state: 'ready', detail: 'ETH MVRV · 2026-10-07 · Coin Metrics' },
};
export const Delayed: Story = { args: { state: 'delayed', detail: '마지막 정상 관측 2026-10-05' } };
export const Unsupported: Story = {
  args: { state: 'unsupported', detail: 'ONDO MVRV 원천 미확보' },
};
export const Insufficient: Story = {
  args: { state: 'insufficient-history', detail: '연속 730일 필요 · 확보 420일' },
};
export const Pending: Story = {
  args: { state: 'pending', detail: '아직 저장된 관측이 없습니다.' },
};
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = {
  args: { state: 'error', detail: '원천 응답을 확인하지 못했습니다.', onRetry: () => {} },
};
