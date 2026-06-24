import { ConfirmDialogHost } from 'kitstak-ui';

// ConfirmDialogHost is the single app-root confirmation modal that backs the
// imperative destructiveConfirm() helper. It renders nothing until an action
// opens it via the registered opener, so the default preview shows the closed
// (null) state. There is no prop to force it open.
export function Closed() {
  return <ConfirmDialogHost />;
}
