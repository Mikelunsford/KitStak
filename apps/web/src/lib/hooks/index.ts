export { useMe } from './useMe';
export { useBranding } from './useBranding';
export { useCapabilities } from './useCapabilities';
export type { CapabilitiesApi } from './useCapabilities';
export { useSwitchOrg } from './useSwitchOrg';

export { useSessionSwitch } from './useSessionSwitch';
export { useTenantBranding } from './useTenantBranding';
export {
  useSettings,
  useSettingGroup,
  useUpsertSetting,
  useDeleteSetting,
  useBrandingAdmin,
  usePatchBranding,
  useNumberingSequences,
  useNumberingSequence,
  useResetNumbering,
} from './useSettings';
export { useFlags, useUpsertFlag } from './useFlags';
export { useOrgFlags } from './useOrgFlags';
export { useFeatureFlag } from './useFeatureFlag';
export type { FeatureFlagResult, FeatureFlagSource } from './useFeatureFlag';

// CRM (Wave 2, Agent B)
export { useCustomers } from './useCustomers';
export { useCustomer } from './useCustomer';
export { useLeads } from './useLeads';
export { useConvertLead } from './useConvertLead';

// Feedback / support ticketing (migration 0140)
export {
  useMyTickets,
  useTicket,
  useTicketComments,
  useCreateTicket,
  useAddComment,
  useIsPlatformStaff,
  useStaffTickets,
  useStaffTicket,
  useStaffTicketComments,
  useUpdateTicketStaff,
  useAddStaffComment,
} from './useFeedback';
