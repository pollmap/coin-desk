export function belongsToSection(id: string, section: string) {
  return section === 'onchain'
    ? /^(net|btc|chain):/.test(id)
    : section === 'futures'
      ? id.startsWith('futures:')
      : true;
}

export function focusMetric(id: string, selected: string[], section: string) {
  if (!belongsToSection(id, section)) return selected;
  return [id, ...selected.filter((v) => v !== id && belongsToSection(v, section))].slice(0, 6);
}
