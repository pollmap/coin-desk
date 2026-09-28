import type { ResearchItem } from './research-library';

export type ReviewFilter = '' | 'text' | 'images' | 'method' | 'complete';
export type SearchDocument = Pick<
  ResearchItem,
  'id' | 'text' | 'author' | 'publishedAt' | 'note' | 'assets' | 'methods' | 'review'
> & { hasImages: boolean };
export function searchDocument(item: ResearchItem): SearchDocument {
  const { id, text, author, publishedAt, note, assets, methods, review } = item;
  return {
    id,
    text,
    author,
    publishedAt,
    note,
    assets,
    methods,
    review,
    hasImages: item.media.length > 0,
  };
}
const fold = (text: string) => text.normalize('NFKC').toLowerCase();
export function buildLibraryIndex(items: SearchDocument[]) {
  return items
    .map((item) => ({
      ...item,
      search: fold(
        [item.text, item.author, item.publishedAt, item.note, ...item.methods].join(' '),
      ),
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}
export function searchLibrary(
  index: ReturnType<typeof buildLibraryIndex>,
  options: {
    query?: string;
    asset?: string;
    method?: string;
    author?: string;
    review?: ReviewFilter;
  },
) {
  const terms = fold(options.query ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return index
    .filter((item) => {
      if (
        (options.asset && !item.assets.some((a) => a === options.asset)) ||
        (options.method && !item.methods.includes(options.method)) ||
        (options.author && item.author !== options.author)
      )
        return false;
      const review = options.review;
      if (
        review === 'complete' &&
        !(item.review.text && (!item.hasImages || item.review.images) && item.review.method)
      )
        return false;
      if (
        review &&
        review !== 'complete' &&
        (item.review[review] || (review === 'images' && !item.hasImages))
      )
        return false;
      return terms.every((term) => item.search.includes(term));
    })
    .map((item) => item.id);
}
