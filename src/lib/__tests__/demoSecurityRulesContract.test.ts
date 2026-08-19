import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('Demo tenant security rules contract',()=>{
 const rules=readFileSync('firestore.rules','utf8');
 it('limits company metadata to canonical company with owner/super-admin preservation',()=>{expect(rules).toContain("companyId == userCompanyId()");expect(rules).toContain('isOwnerIdentity() || isSuperAdmin()')});
 it('validates mapping against token and canonical user company',()=>{
   // hasValidAuthMap re-anchors the signed-in identity to the auth map
   // (mapping doc id == auth.uid, mapping email == token email). The anchor
   // is the MAPPING's userId — master-identity users (users/MUSR-{companyId}-
   // {phone}, the canonical production shape) legitimately have userId !=
   // auth.uid, so the old `userId == request.auth.uid` equality denied every
   // company-scoped rule for real users. The users-doc <-> mapping
   // cross-validation (canonical user company + email) is enforced at WRITE
   // time by validOwnMapping (below), which is cheaper than re-walking the
   // users doc on every read and keeps the rules under the 1000-expression
   // evaluation budget.
   expect(rules).toContain('function hasValidAuthMap()');
   expect(rules).toContain('get(authMapPath()).data.userId is string');
   expect(rules).toContain('get(authMapPath()).data.email == request.auth.token.email');
   expect(rules).toContain('function validOwnMapping(data)');
   expect(rules).toContain('getAfter(/databases/$(database)/documents/users/$(data.userId)).data.companyId == data.companyId');
   expect(rules).toContain('getAfter(/databases/$(database)/documents/users/$(data.userId)).data.email == request.auth.token.email');
   // D2 guard: isSuperAdmin may only be granted OR revoked by a super-admin
   // (value-equality over the merged doc — no-op writes and legacy docs that
   // lack the field stay allowed; grant and revoke are denied).
   expect(rules).toContain('(request.resource.data.isSuperAdmin == true) == (resource.data.isSuperAdmin == true)');
   // Owner statement must be independent of the auth-map anchor (owner keeps
   // user-management even if the lazy mapping is missing/purged).
   // F-13 (Phase 0): every clause is gated on actorIsActive() — deactivated
   // users keep zero authority. The regex therefore allows the optional
   // actorIsActive() prefix before isOwnerIdentity().
   expect(rules).toMatch(/allow update: if (?:actorIsActive\(\) && )?isOwnerIdentity\(\)[\s\S]*?companyId == resource\.data\.companyId/);
 })
 it('has explicit isolated phone-lock rules',()=>{expect(rules).toContain('match /customer_phone_locks/{lockId}');expect(rules).toContain('request.resource.data.customerId == resource.data.customerId')});
 it('keeps immutable system records protected',()=>{expect(rules).toMatch(/match \/stock_ledger[\s\S]*allow update, delete: if false/);expect(rules).toMatch(/match \/audit_logs[\s\S]*allow update, delete: if false/)});
 it('Phase 1: guards users.channelPartnerId immutability (partner link)',()=>{
   // linkPartnerUser is the ONLY writer of users.channelPartnerId; the
   // channelPartnerLinkUnchanged() helper must gate every users update path
   // (owner + non-owner branches) with a keys().hasAny() first so a missing
   // field never becomes a hard denial.
   expect(rules).toContain('function channelPartnerLinkUnchanged()');
   expect(rules).toContain("!resource.data.keys().hasAny(['channelPartnerId'])");
   expect(rules).toMatch(/function channelPartnerLinkUnchanged\(\)[\s\S]*?request\.resource\.data\.channelPartnerId == resource\.data\.channelPartnerId/);
   const refs = rules.match(/channelPartnerLinkUnchanged\(\)/g) || [];
   expect(refs.length).toBeGreaterThanOrEqual(3); // definition + both users update branches
 })
 it('Phase 1: canonical partner self-read resolves through users.channelPartnerId',()=>{
   // The partner's own record resolves via the user-side denormalized link
   // users/{uid}.channelPartnerId == {partnerId} (set by linkPartnerUser),
   // in addition to the legacy partner-side `userId` field.
   expect(rules).toContain('function partnerLinkedToSelf(partnerId)');
   expect(rules).toContain('data.channelPartnerId == partnerId');
   expect(rules).toMatch(/function partnerLinkedToSelf\(partnerId\)[\s\S]*?currentUserId\(\)[\s\S]*?data\.channelPartnerId == partnerId/);
 })
 it('Phase 1: channel_partners.userId (partner-side link) is immutable once established',()=>{
   // Mirror of the users.channelPartnerId guard: the other half of the
   // linkPartnerUser dual-write. Absent OR empty-string means 'not linked'
   // (demo seed uses '' for the unlinked partner), so the first controlled
   // link stays allowed; a real value can never be changed/cleared by a
   // direct same-company update.
   expect(rules).toContain('function partnerUserIdUnchanged()');
   expect(rules).toContain("!resource.data.keys().hasAny(['userId'])");
   expect(rules).toContain("resource.data.userId == ''");
   // Phase 2 (Master Plan §9.3): the update path is the additive-OR form
   // (existing Company authorization || Group Admin §5.2) — the userId
   // immutability guard still gates EVERY update branch.
   expect(rules).toMatch(/allow update: if \(canUpdateCompanyScoped\(\) \|\| groupAdminCanUpdate\(resource\.data\)\) && partnerUserIdUnchanged\(\);/);
 })
 it('Phase 6: scheme_registrations has an explicit rules block overriding the catch-all',()=>{
   // Spec §19 — the collection must NOT fall through to the generic
   // sameCompany wildcard; it is added to isSpecialCollection so the
   // wildcard denies it, and the explicit match block enforces the
   // partner/team/Director/Admin scope at rules level.
   expect(rules).toContain("'scheme_registrations'");
   expect(rules).toContain("match /scheme_registrations/{id}");
   expect(rules).toMatch(/function isSpecialCollection\(collectionId\)[\s\S]*?'scheme_registrations'/);
   // Read scope: partner self via canonical users.channelPartnerId,
   // TL/Manager team via channel_partners.managerId, Director view-only,
   // Admin; tenant isolation via sameCompany.
   expect(rules).toContain('function schemeRegCanRead(data)');
   expect(rules).toMatch(/function schemeRegCanRead\(data\)[\s\S]*?partnerLinkedToSelf\(data\.partnerId\)/);
   expect(rules).toMatch(/function schemeRegCanRead\(data\)[\s\S]*?roleMatches\('Director'\)/);
   expect(rules).toContain('function schemeRegManagerOfPartner(partnerId)');
   expect(rules).toMatch(/function schemeRegManagerOfPartner\(partnerId\)[\s\S]*?channel_partners\/\$\(partnerId\)[\s\S]*?data\.managerId == currentUserId\(\)/);
   // Write validation: a partner can only create on a project whose
   // partnerId == the authenticated partner (§9.3 anti-spoofing).
   expect(rules).toContain('function schemeRegPartnerOwnsProject(data)');
   expect(rules).toMatch(/function schemeRegPartnerOwnsProject\(data\)[\s\S]*?projects\/\$\(data\.projectId\)[\s\S]*?data\.partnerId == data\.partnerId/);
   // Partner update: pre-completion states + partner-side targets only.
   expect(rules).toMatch(/resource\.data\.status in \['Draft', 'Submitted', 'Rejected', 'Failed'\]/);
   expect(rules).toMatch(/request\.resource\.data\.status in \['Draft', 'Submitted', 'Cancelled'\]/);
   // Identity immutability: partnerId/projectId/companyId cannot change.
   expect(rules).toContain('function schemeRegIdentityUnchanged()');
   // Protected records: hard delete is Admin-only.
   // Phase 2 (§5.2/§9.3): hard delete is Admin-only (Group-scoped for Group
   // Admin) — the additive-OR form keeps the Admin sameCompany branch intact.
   expect(rules).toMatch(/match \/scheme_registrations\/\{id\}[\s\S]*?allow delete: if actorIsActive\(\) && \(\(isAdmin\(\) && sameCompany\(resource\.data\)\) \|\| \(isGroupAdmin\(\) && sameGroup\(resource\.data\)\)\);/);
   // Director is VIEW-ONLY (spec §18) — the scheme_registrations update rule
   // must not grant Director write access.
   const updateSection = rules.match(/match \/scheme_registrations\/\{id\}[\s\S]*?allow delete/)?.[0] ?? '';
   expect(updateSection).not.toContain("roleMatches('Director')");
 })
 it('Phase 6: storage rules enforce case-scoped Registration documents',()=>{
   // Spec §15/§19 — documents resolve through the owning case/project; the
   // companies catch-all must not grant the scoped document paths.
   //
   // Phase 8 update: the companies catch-all's scoped-document exclusion was
   // rewritten from a broken `allPaths.matches(...)` regex (the real Storage
   // Rules emulator rejects `.matches()`/`.split()` at evaluation time — see
   // storage.rules' Phase 8 NOTE comments and
   // multiTenantStorageSecurity.emulator.test.ts) to a match-PATTERN-based
   // first-segment exclusion. The two function-body assertions below
   // (canReadScopedDocuments/canWriteScopedDocuments) were also updated from
   // the old imperative `if (cond) return x;` chain — likewise invalid
   // Storage Rules syntax — to the ternary-chain rewrite. This test still
   // proves the same functional contract via the new (now actually-valid,
   // actually-tested) shape.
   const storage = readFileSync('storage.rules', 'utf8');
   expect(storage).toContain('match /companies/{companyId}/cases/{caseId}/documents/{fileName}');
   expect(storage).toContain('match /companies/{companyId}/projects/{projectId}/documents/{fileName}');
   expect(storage).toMatch(/match \/companies\/\{companyId\}\/\{first\}\/\{rest=\*\*\}[\s\S]*?!\(first == 'cases' \|\| first == 'projects'\)/);
   expect(storage).toMatch(/function canReadScopedDocuments\(companyId, docPath\)[\s\S]*?currentUserRole\(\) == 'Accounts' \? false/);
   expect(storage).toMatch(/function canWriteScopedDocuments\(companyId, docPath\)[\s\S]*?isOwnerPartner\(docPartnerId\(docPath\)\)/);
   expect(storage).toMatch(/function canReadScopedDocuments\(companyId, docPath\)[\s\S]*?isManagerOfPartner\(docPartnerId\(docPath\)\)/);
   expect(storage).toMatch(/function canReadScopedDocuments\(companyId, docPath\)[\s\S]*?isOwnerPartner\(docPartnerId\(docPath\)\)/);
   expect(storage).toMatch(/function docPartnerId\(docPath\)[\s\S]*?keys\(\)\.hasAny\(\['partnerId'\]\)/);
   // Cross-company denial on every scoped path.
   expect(storage).toMatch(/currentUserCompanyId\(\) != companyId \? false/);
 })
});
