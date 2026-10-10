import { ASSETS } from './catalog';
import type { Asset } from './types';

export const PERSONAL_DESK_KEY = 'coin-desk.personal.v1';
export const defaultFavorites: readonly Asset[] = ['BTC', 'DOGE', 'ETH'];
export function validFavorites(value: unknown): Asset[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is Asset => ASSETS.some((a) => a.id === id)))].slice(
        0,
        ASSETS.length,
      )
    : [...defaultFavorites];
}

/** Change only favorites, preserving stored analyses and future extra fields. */
export function toggleFavorite(
  value: unknown,
  asset: Asset,
): Record<string, unknown> & { favorites: Asset[] } {
  if (!ASSETS.some((a) => a.id === asset)) throw new Error('지원하지 않는 코인입니다.');
  const desk =
    value == null
      ? { version: 2, cards: ['mvrv', 'realized_price', 'sopr_24h', 'nupl'], workspaces: [] }
      : value;
  if (
    typeof desk !== 'object' ||
    Array.isArray(desk) ||
    ![1, 2].includes((desk as { version?: number }).version ?? 0)
  )
    throw new Error('저장한 설정 형식을 확인할 수 없습니다. 내 저장에서 백업을 확인해 주세요.');
  const current = desk as Record<string, unknown>,
    favorites = validFavorites(current.favorites);
  return {
    ...current,
    favorites: favorites.includes(asset)
      ? favorites.filter((a) => a !== asset)
      : [...favorites, asset],
  };
}
