import {
  PM_V2_CONTRACT,
  PM_V2_ROLES,
  type PmV2Contract,
  type PmV2Role,
  type PmV2RoleProfile,
} from "./pm-contract.js";

export function isPmV2Role(value: string): value is PmV2Role {
  return (PM_V2_ROLES as readonly string[]).includes(value);
}

export function getPmV2RoleProfile(
  role: PmV2Role,
  contract: Readonly<PmV2Contract> = PM_V2_CONTRACT,
): Readonly<PmV2RoleProfile> {
  return contract.roleProfiles[role];
}
