import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { auth, firebaseEnv } from '../../../lib/firebase';
import { resolveAuthenticatedErpUser } from '../../../lib/authIdentity';
import {
  loadCurrentUserProfile,
  normalizeUserProfile,
  profileToAppUser,
  syncCurrentUserProfile,
  updateCurrentUserProfile,
  type CanonicalUserProfile,
  type UserProfileSaveInput,
} from '../../../lib/userProfile';
import { useAppStore } from '../../../store/useAppStore';

export const MY_PROFILE_QUERY_KEY = ['users', 'current-profile'] as const;

export function useMyProfile() {
  const storedUser = useAppStore((state) => state.user);
  const storedUserId = storedUser?.id || '';
  const queryClient = useQueryClient();

  const profileQuery = useQuery<CanonicalUserProfile>({
    queryKey: [...MY_PROFILE_QUERY_KEY, auth.currentUser?.uid || storedUserId],
    queryFn: async () => {
      const authUser = auth.currentUser;

      // Platform Owner identity (src/lib/ownerAccess.ts createOwnerAppIdentity,
      // set by Login.tsx for the single hardcoded owner email): a client-only
      // synthetic identity (id `owner:{authUid}`) with NO backing users/{id}
      // Firestore document by design — useGlobalBoot.ts's own profile
      // self-heal effect already skips this exact case for the same reason
      // ("if (!user?.id || user.isOwner) return; ... the Owner's synthetic
      // identity has no users/{id} doc by design (skipped)"). loadCurrentUserProfile()
      // and resolveAuthenticatedErpUser() both correctly assume every OTHER
      // authenticated identity has a real ERP user document and throw when it
      // doesn't — for the Owner that document will never exist, so build the
      // canonical profile directly from the already-authenticated synthetic
      // identity instead of attempting a Firestore read that can only fail.
      if (storedUser?.isOwner) {
        return normalizeUserProfile({ ...storedUser, id: storedUser.id, phone: storedUser.phone || '' });
      }

      const storeIdentityIsCanonical = Boolean(
        authUser && storedUser && storedUser.id !== authUser.uid
        && storedUser.email.trim().toLowerCase() === authUser.email?.trim().toLowerCase(),
      );

      // Login already resolved this canonical ERP ID. Revalidate the profile with
      // one direct document read instead of repeating mapping + user reads.
      if (!firebaseEnv.isConfigured || !authUser || storeIdentityIsCanonical) {
        return await loadCurrentUserProfile(storedUserId);
      }

      // Recovery path for stale/unknown store identity. The resolver already
      // returns the canonical user document, so do not fetch it a second time.
      const resolved = await resolveAuthenticatedErpUser(authUser);
      return normalizeUserProfile({ ...resolved, id: resolved.id });
    },
    enabled: Boolean((auth.currentUser?.uid || storedUserId) && storedUserId !== 'system'),
    initialData: storedUser && storedUser.id !== 'system'
      ? normalizeUserProfile({
          ...storedUser,
          id: storedUser.id,
          name: storedUser.name,
          displayName: storedUser.displayName || storedUser.name,
          email: storedUser.email,
          companyId: storedUser.companyId,
          phone: storedUser.phone || '',
          avatarUrl: storedUser.avatarUrl || storedUser.avatar,
        })
      : undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30 * 1000,
    retry: 1,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: UserProfileSaveInput) => {
      const authUser = auth.currentUser;
      const userId = profileQuery.data?.id || storedUserId;
      return await updateCurrentUserProfile({
        userId,
        authUser,
        profile: input,
      });
    },
    onSuccess: (profile) => {
      queryClient.setQueryData([...MY_PROFILE_QUERY_KEY, auth.currentUser?.uid || storedUserId], profile);
      syncCurrentUserProfile(profile);
      useAppStore.getState().setUser(profileToAppUser(profile));
      toast.success('Profile saved');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to save profile');
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: MY_PROFILE_QUERY_KEY });
    return await profileQuery.refetch();
  };

  return {
    userId: profileQuery.data?.id || storedUserId,
    profileQuery,
    saveMutation,
    refresh,
  };
}
