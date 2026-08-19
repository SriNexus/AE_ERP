import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clearDemoSession } from '../lib/demoSession';
import { queryClient } from '../lib/queryClient';
import { DEFAULT_COMPANY, type CompanyConfig } from '../config/company';

export type AppUser = {
  id: string;
  name: string;
  displayName?: string;
  email: string;
  role: string;
  phone?: string;
  companyId: string;
  // Phase 2 (Master Plan §3.2/§9.4): the user's denormalized groupId — for a
  // GroupAdmin this is their authoritative Group (drives the 'group' query
  // sentinel); for every other role it mirrors their company's Group.
  groupId?: string;
  warehouseId?: string;
  avatar?: string;
  avatarUrl?: string;
  signatureUrl?: string;
  managerId?: string;
  department?: string;
  status?: string;
  isSuperAdmin?: boolean;
  isOwner?: boolean;
};
export type RuntimePermissionMap = Record<string, unknown>;
export type RuntimePermissionCache = { ready:boolean; roles:RuntimePermissionMap; loadedAt?:string; diagnostics:string[] };

// ─── Theme note ───────────────────────────────────────────
// Theme state is intentionally NOT stored in Zustand.
// Single source of truth: localStorage['neozy-theme-mode']
// Read/written exclusively through src/theme/useTheme.ts
// The DOM class (.dark) is applied by:
//   1. index.html inline script (pre-React, no FOUC)
//   2. useTheme hook on mount and on change
// ─────────────────────────────────────────────────────────

type NavigationStyle = 'sidebar' | 'app-launcher';

type AppStore = {
  user:AppUser|null; isAuthenticated:boolean;
  globalCompany:CompanyConfig|null; company:CompanyConfig; activeCompanyId:string;
  sidebarOpen:boolean; roleData:any|null; teamMemberIds:string[]; permissionCache:RuntimePermissionCache;
  navigationStyle:NavigationStyle;
  // Phase 1 (Multi-Tenant): companyId -> groupId lookup, populated at boot from
  // the already-loaded companies list (Master Plan §3.4 — "already-loaded
  // company/store state", no new Firestore read). resolveWriteGroupId() uses
  // this to stamp authoritative groupId on writes. Not persisted — derived
  // session state, rebuilt on every boot.
  companyGroupIds: Record<string, string>;
  setUser:(u:AppUser)=>void; setRoleData:(r:any)=>void; setTeamMemberIds:(ids:string[])=>void; setPermissionCache:(cache:RuntimePermissionCache)=>void;
  setCompanyGroupIds:(map:Record<string,string>)=>void;
  logout:()=>void; setGlobalCompany:(c:CompanyConfig)=>void; setCompany:(c:CompanyConfig)=>void;
  setActiveCompanyId:(id:string)=>void; setSidebarOpen:(v:boolean)=>void; toggleSidebar:()=>void;
  setNavigationStyle:(s:NavigationStyle)=>void;
};

const EMPTY_PERMISSION_CACHE: RuntimePermissionCache = { ready:false, roles:{}, diagnostics:[] };

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      user:null, isAuthenticated:false, globalCompany:null, company:DEFAULT_COMPANY,
      activeCompanyId:'default', sidebarOpen:true, roleData:null, teamMemberIds:[], permissionCache:EMPTY_PERMISSION_CACHE,
      companyGroupIds:{},
      setUser:(user)=>set({user,isAuthenticated:true}),
      setRoleData:(roleData)=>set({roleData}),
      setTeamMemberIds:(teamMemberIds)=>set({teamMemberIds}),
      setPermissionCache:(permissionCache)=>set({permissionCache}),
      setCompanyGroupIds:(companyGroupIds)=>set((state)=>{
        if (state.companyGroupIds === companyGroupIds) return {};
        return {companyGroupIds};
      }),
      logout:()=>{
    clearDemoSession();
    set({user:null,isAuthenticated:false,roleData:null,teamMemberIds:[],permissionCache:EMPTY_PERMISSION_CACHE,
      companyGroupIds:{},
      // Root-cause fix (homepage demo-data isolation): company context must NOT
      // survive logout. activeCompanyId/company/globalCompany were persisted, so
      // a prior demo session left 'company-demo-neozy' in the store and the next
      // login (especially the Owner/Super-Admin path, which inherits the persisted
      // activeCompanyId) kept querying the demo company — the homepage then
      // rendered demo KPIs/charts for production Admin/Super Admin sessions.
      // Reset to neutral and let useGlobalBoot resolve the real company.
      activeCompanyId:'default', company:DEFAULT_COMPANY, globalCompany:null});
    // Root-cause fix (Demo Mode live reset investigation): the React Query
    // cache is a module-level singleton that previously survived a
    // logout/login cycle in the same tab (gcTime is 30 minutes,
    // refetchOnWindowFocus is disabled) — a user could log out of one
    // session and log back in as demo@neozy.in and still render the PRIOR
    // session's cached query results until they expired on their own.
    // Clearing on every logout makes every fresh login start from a
    // genuinely empty cache, for demo and real sessions alike.
    queryClient.clear();
  },
      setGlobalCompany:(globalCompany)=>set((state)=>{
        if (state.globalCompany === globalCompany) return {};
        return {globalCompany};
      }),
      setCompany:(company)=>set((state)=>{
        if (state.company === company) return {};
        return {company};
      }),
      setActiveCompanyId:(activeCompanyId)=>set((state)=>{
        if (state.activeCompanyId === activeCompanyId) return {};
        return {activeCompanyId};
      }),
  navigationStyle:'sidebar',
  setNavigationStyle:(navigationStyle)=>set({navigationStyle}),
  setSidebarOpen:(sidebarOpen)=>set({sidebarOpen}),
  toggleSidebar:()=>set(s=>({sidebarOpen:!s.sidebarOpen})),
    }),
    {
      name:'neozy-v1',
      // theme intentionally excluded — owned by localStorage['neozy-theme-mode'] via useTheme
      partialize:(s)=>({ sidebarOpen:s.sidebarOpen, user:s.user, isAuthenticated:s.isAuthenticated, activeCompanyId:s.activeCompanyId, globalCompany:s.globalCompany, company:s.company, navigationStyle:s.navigationStyle }),
    }
  )
);

const DEFAULT_USER: AppUser = { id:'system', name:'System', displayName:'System', email:'system@erp.local', role:'Admin', companyId:'default' };
export function useCurrentUser(): AppUser { return useAppStore(s=>s.user) ?? DEFAULT_USER; }
