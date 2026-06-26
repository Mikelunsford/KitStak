export { getMe, MeSchema, MembershipSchema } from './meService';
export type { Me, Membership } from './meService';
export { getBranding, BrandingSchema } from './brandingService';
export type { Branding } from './brandingService';

export { switchOrg, getMyCapabilities } from './sessionService';
export type {
  CapabilityList,
  SwitchOrgRequest,
  SwitchOrgResponse,
} from './sessionService';

export {
  resolveHost,
  getTenantBranding,
  getActiveTenant,
} from './tenantsService';

export {
  listSettings,
  listSettingGroup,
  upsertSetting,
  deleteSetting,
  getBrandingRow,
  patchBranding,
  listNumberingSequences,
  getNumberingSequence,
  resetNumberingSequence,
} from './settingsService';
export type { BrandingPatch } from './settingsService';

export { listFeatureFlags, upsertFeatureFlag } from './flagsService';
export type { FlagUpsertInput } from './flagsService';

export { listPlatformOrgs, readPlatformAuditPage } from './adminService';

// CRM (Wave 2, Agent B)
export {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
} from './customersService';
export type { ListCustomersFilters } from './customersService';
export {
  listContacts,
  getContact,
  createContact,
  updateContact,
} from './contactsService';
export type { ListContactsFilters } from './contactsService';
export {
  listActivities,
  createActivity,
} from './activitiesService';
export type { ListActivitiesFilters } from './activitiesService';
export {
  listLeads,
  getLead,
  createLead,
  updateLead,
  convertLead,
} from './leadsService';
export type { ListLeadsFilters } from './leadsService';
export {
  listOpportunities,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  transitionOpportunityStage,
} from './opportunitiesService';
export type { ListOpportunitiesFilters } from './opportunitiesService';
