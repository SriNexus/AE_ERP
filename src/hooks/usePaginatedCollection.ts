import { useInfiniteQuery } from '@tanstack/react-query';
import { getPage, type DocWithId, type PageCursor } from '../lib/firestore';

export function usePaginatedCollection<T>(
  queryKey: readonly unknown[],
  collectionName: string,
  staleTime = 30_000
) {
  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: null as PageCursor,
    queryFn: ({ pageParam }) => getPage<T>(collectionName, [], pageParam as PageCursor),
    getNextPageParam: (lastPage) => (lastPage?.hasMore ? lastPage.cursor ?? undefined : undefined),
    staleTime,
  });
  const pages = result.data?.pages ?? [];
  const data = pages.flatMap((page) => Array.isArray(page?.data) ? page.data : []) as DocWithId<T>[];

  return {
    ...result,
    data,
    loadMore: result.fetchNextPage,
    hasMore: Boolean(result.hasNextPage),
    loadingMore: result.isFetchingNextPage,
  };
}
