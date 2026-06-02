// StatusBadge (portal). Re-export of the shared component promoted to
// components/ui/StatusBadge.tsx (F-Wave10-UI-KIT-01). Kept as a stable import
// path for the existing portal pages and the StatusBadge.test.ts beside it;
// the logic and vocabulary now live in one shared place used by both the
// portal and the operator app.

export {
  StatusBadge,
  humaniseStatus,
  statusColorClass,
} from '@/components/ui/StatusBadge';
