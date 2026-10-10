import { useEffect, useState } from 'react';
import { PERSONAL_DESK_KEY, validFavorites, toggleFavorite } from '../shared/personal-favorites';
import type { Asset } from '../shared/types';

function readFavorites() {
  try {
    return validFavorites(JSON.parse(localStorage.getItem(PERSONAL_DESK_KEY) || 'null')?.favorites);
  } catch {
    return validFavorites(null);
  }
}
export function useFavorites() {
  const [favorites, setFavorites] = useState(readFavorites);
  useEffect(() => {
    const update = () => setFavorites(readFavorites());
    const stored = (e: StorageEvent) => {
      if (!e.key || e.key === PERSONAL_DESK_KEY) update();
    };
    window.addEventListener('coin-desk-personal', update);
    window.addEventListener('storage', stored);
    return () => {
      window.removeEventListener('coin-desk-personal', update);
      window.removeEventListener('storage', stored);
    };
  }, []);
  const toggle = (asset: Asset) => {
    const raw = JSON.parse(localStorage.getItem(PERSONAL_DESK_KEY) || 'null');
    const next = toggleFavorite(raw, asset);
    localStorage.setItem(PERSONAL_DESK_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('coin-desk-personal'));
  };
  return { favorites, toggle };
}
