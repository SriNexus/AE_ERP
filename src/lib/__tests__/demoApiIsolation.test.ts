import { describe, expect, it } from 'vitest';
import { canAccessApiResource, isGlobalCollection, resolveApiCompanyScope } from '../../../api/_lib/registry.ts';

describe('API tenant isolation contract',()=>{
 const demo={companyId:'company-demo-neozy',isSuperAdmin:false};
 it('treats users and companies as tenant scoped and only roles as global',()=>{expect(isGlobalCollection('roles')).toBe(true);expect(isGlobalCollection('users')).toBe(false);expect(isGlobalCollection('companies')).toBe(false)});
 it('ignores request-supplied company scope for normal identities',()=>{expect(resolveApiCompanyScope(demo,'company-production')).toBe('company-demo-neozy')});
 it('preserves intentional super-admin company selection',()=>{expect(resolveApiCompanyScope({companyId:'default',isSuperAdmin:true},'company-production')).toBe('company-production')});
 it('denies production records to demo and allows own-company records',()=>{expect(canAccessApiResource(demo,'leads',{companyId:'company-production'})).toBe(false);expect(canAccessApiResource(demo,'leads',{companyId:'company-demo-neozy'})).toBe(true)});
});
