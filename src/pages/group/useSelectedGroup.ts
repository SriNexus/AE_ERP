/**
 * useSelectedGroup — Super Admin group-browsing selector for the Group
 * Administration console (Group Overview / Teams / Settings only).
 *
 * These 3 screens are SuperAdminRoute-gated; the Owner/Super Admin identity
 * carries no `groupId` of its own (it isn't a member of any single Group), so
 * unlike a real GroupAdmin actor these screens cannot resolve "my Group" from
 * the signed-in identity. Instead the actor explicitly picks which Group to
 * view from every real Group (fetched via getAllPlatform, owner/Super Admin
 * only), persisted in the `?groupId=` URL param so it's shareable and
 * survives a refresh. Reads for the selected Group use direct
 * where('groupId','==', selectedGroupId) queries (mirroring
 * useGroupCompanies' existing pattern) rather than the shared getAll()
 * 'group'-sentinel path, which is keyed to the ACTOR's own groupId and would
 * stay empty for the Owner identity no matter what is selected here.
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { query, collection, where, getDocs } from 'firebase/firestore';
import { getAllPlatform, fromDoc } from '../../lib/firestore';
import { db, COLLECTIONS } from '../../lib/firebase';

export type GroupOption = { id: string; name?: string; shortName?: string; status?: string };

export function useGroupList() {
  return useQuery<GroupOption[]>({
    queryKey: ['platform-groups-selector'],
    queryFn: () => getAllPlatform<GroupOption>(COLLECTIONS.GROUPS),
    staleTime: 30_000,
    select: (docs) => docs.filter((g) => (g as any).isDeleted !== true),
  });
}

export function useSelectedGroupId() {
  const { data: groups = [], isLoading } = useGroupList();
  const [searchParams, setSearchParams] = useSearchParams();

  const paramGroupId = searchParams.get('groupId') || '';
  const selectedGroupId = useMemo(() => {
    if (paramGroupId && groups.some((g) => g.id === paramGroupId)) return paramGroupId;
    return groups[0]?.id || '';
  }, [paramGroupId, groups]);

  useEffect(() => {
    if (!selectedGroupId || paramGroupId === selectedGroupId) return;
    const next = new URLSearchParams(searchParams);
    next.set('groupId', selectedGroupId);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId]);

  const setSelectedGroupId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('groupId', id);
    setSearchParams(next);
  };

  return { groups, isLoading, selectedGroupId, setSelectedGroupId };
}

/**
 * Direct where('groupId','==', groupId) read for one collection, scoped to
 * the Super Admin's currently-selected Group. Mirrors useGroupCompanies'
 * existing, rules-provable query shape (companies read rule's owner/Super
 * Admin branch grants unrestricted read, so this is not a new access grant —
 * it is a client query shaped to actually use it for an arbitrary Group,
 * instead of the shared getAll() helper which only ever resolves the
 * signed-in actor's OWN groupId).
 */
export function useGroupScopedCollection<T extends { isDeleted?: boolean }>(
  collectionName: string,
  groupId: string,
  queryKeyPrefix: string,
) {
  return useQuery<T[]>({
    queryKey: [queryKeyPrefix, groupId],
    queryFn: async () => {
      if (!groupId) return [];
      const snap = await getDocs(query(collection(db, collectionName), where('groupId', '==', groupId)));
      return snap.docs.map((d) => fromDoc<T>(d as any));
    },
    staleTime: 30_000,
    enabled: !!groupId,
    select: (docs) => docs.filter((d) => d.isDeleted !== true),
  });
}
