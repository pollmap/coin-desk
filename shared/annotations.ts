export type DrawingKind = 'horizontal' | 'trend' | 'channel' | 'measure';
export interface Annotation {
  id: string;
  kind: DrawingKind;
  points: { time: number; value: number }[];
}
export function validAnnotations(input: unknown): Annotation[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-60)
    .filter(
      (a): a is Annotation =>
        a &&
        typeof a.id === 'string' &&
        a.id.length < 100 &&
        ['horizontal', 'trend', 'channel', 'measure'].includes(a.kind) &&
        Array.isArray(a.points) &&
        a.points.length === (a.kind === 'horizontal' ? 1 : a.kind === 'channel' ? 3 : 2) &&
        a.points.every(
          (p: { time: number; value: number }) =>
            Number.isFinite(p.time) && p.time > 0 && Number.isFinite(p.value),
        ),
    );
}
export function annotationKey(asset: string, source: string, interval: string, metric = 'price') {
  return [asset, source, interval, metric].join(':');
}
