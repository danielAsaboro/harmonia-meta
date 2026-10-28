import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "./authority";

const TENANT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type WorkspaceRole = "owner" | "admin" | "member" | "service";
const WORKSPACE_ROLES = new Set<WorkspaceRole>(["owner", "admin", "member", "service"]);

export interface TenantScope {
  workspaceId: string;
  brandId: string;
}

export interface TenantContext extends TenantScope {
  principal: Principal;
}

export interface WorkspaceOwned {
  workspaceId: string;
  brandId?: string;
}

export function requireWorkspaceRole(value: unknown): WorkspaceRole {
  if (typeof value !== "string" || !WORKSPACE_ROLES.has(value as WorkspaceRole)) {
    throw new Error("invalid workspace role");
  }
  return value as WorkspaceRole;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, work: () => T): T {
  validateTenantScope(context);
  checkedId("subjectId", context.principal.subjectId);
  checkedId("authenticationId", context.principal.authenticationId);
  return tenantStorage.run(context, work);
}

export function currentTenant(): TenantContext {
  const context = tenantStorage.getStore();
  if (!context) throw new Error("tenant context required");
  return context;
}

function checkedId(label: string, value: string): string {
  if (!TENANT_ID.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

export function validateTenantScope(scope: TenantScope): TenantScope {
  return {
    workspaceId: checkedId("workspaceId", scope.workspaceId),
    brandId: checkedId("brandId", scope.brandId),
  };
}

export function tenantCollectionPath(scope: TenantScope, collection: string): string {
  const checked = validateTenantScope(scope);
  return `workspaces/${checked.workspaceId}/${checkedId("collection", collection)}`;
}

export function tenantDocumentPath(
  scope: TenantScope,
  collection: string,
  documentId: string,
): string {
  return `${tenantCollectionPath(scope, collection)}/${checkedId("documentId", documentId)}`;
}

export function assertResourceWorkspace(
  scope: TenantScope,
  resource: WorkspaceOwned,
): void {
  const expected = validateTenantScope(scope);
  if (resource.workspaceId !== expected.workspaceId) {
    throw new Error("workspace access denied");
  }
  if (resource.brandId !== undefined && resource.brandId !== expected.brandId) {
    throw new Error("brand access denied");
  }
}

export function agentEngineUserId(context: TenantContext, jobId: string): string {
  const subjectId = checkedId("subjectId", context.principal.subjectId);
  checkedId("jobId", jobId);
  const scope = validateTenantScope(context);
  return `${scope.workspaceId}:${subjectId}:${jobId}`;
}

export function tenantSubjectId(context: TenantContext): string {
  return context.principal.subjectId;
}

export function tenantWorkspaceRole(context: TenantContext): WorkspaceRole {
  return context.principal.workspaceRole;
}
