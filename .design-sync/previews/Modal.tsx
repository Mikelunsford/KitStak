import { Modal, Button } from 'kitstak-ui';

const noop = () => {};

export function ConfirmDelete() {
  return (
    <Modal
      open={true}
      onClose={noop}
      title="Void invoice INV-3093"
      footer={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button>Void invoice</Button>
        </>
      }
    >
      <p className="font-sans text-sm text-ink-dim">
        Voiding INV-3093 for Northwind Freight removes it from the open balance and
        records an audit entry. This cannot be undone.
      </p>
    </Modal>
  );
}

export function RecordPayment() {
  return (
    <Modal
      open={true}
      onClose={noop}
      title="Record payment"
      size="lg"
      footer={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button>Apply payment</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 font-sans text-sm text-ink">
        <p className="text-ink-dim">Applying against INV-3094 for Cascade Cold Storage.</p>
        <div className="flex justify-between border border-line px-3 py-2">
          <span className="text-ink-dim">Outstanding balance</span>
          <span className="tabular-nums">$32,900.00</span>
        </div>
      </div>
    </Modal>
  );
}
