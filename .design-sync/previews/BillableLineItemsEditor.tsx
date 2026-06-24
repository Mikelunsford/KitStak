import { BillableLineItemsEditor } from 'kitstak-ui';

interface InvoiceLine {
  id: string;
}

// BillableLineItemsEditor is a detail-page line editor with slot props and a
// built-in ItemPicker that fetches catalog items. Those data hooks are stubbed
// empty in the preview environment, so this renders the empty-state table.
// canEdit is false here so the editor shows its read-only empty state (the
// add-line form and item picker stay hidden).
export function Empty() {
  return (
    <BillableLineItemsEditor<InvoiceLine>
      heading="Line items"
      canEdit={false}
      lines={[]}
      columns={[
        { label: 'Description' },
        { label: 'Qty', align: 'right' },
        { label: 'Unit price', align: 'right' },
        { label: 'Line total', align: 'right' },
      ]}
      renderLine={() => null}
      renderAddFields={() => null}
      onSubmit={() => {}}
      onItemPicked={() => {}}
      emptyLabel="No lines on this invoice yet."
    />
  );
}
