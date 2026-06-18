// Tests for the Workstream A title resolver (2026-06-17 UI scan).
// Covers, per entity kind:
//   - named entities lead with the human name and carry the right number chip
//   - transactional entities fall back to the number when no name exists
//   - nameless entities derive a title from resolved relations
//   - the UUID-in-flight / missing-name fallback to a short id prefix
//   - the shared formatCodeName helper used by EntityLabel

import { describe, it, expect } from 'vitest';

import { displayTitle, formatCodeName } from './displayTitle';

const ID = 'abc12345-dead-beef-cafe-000000000000';

describe('displayTitle: named entities lead with the human name', () => {
  it('quote uses title as H1 and number as the chip', () => {
    expect(displayTitle('quote', { id: ID, number: 'Q-2026-00008', title: 'Fizz Creations - Tetris' })).toEqual({
      title: 'Fizz Creations - Tetris',
      number: 'Q-2026-00008',
    });
  });

  it('project uses name as H1 and number as the chip', () => {
    expect(displayTitle('project', { id: ID, number: 'PRJ-001', name: 'Spring relaunch' })).toEqual({
      title: 'Spring relaunch',
      number: 'PRJ-001',
    });
  });

  it('customer uses display_name and has no number chip', () => {
    expect(displayTitle('customer', { id: ID, display_name: 'Smoke Co.' })).toEqual({
      title: 'Smoke Co.',
      number: null,
    });
  });

  it('item uses name as H1 and sku as the chip', () => {
    expect(displayTitle('item', { id: ID, sku: 'SKU-1', name: 'Widget' })).toEqual({
      title: 'Widget',
      number: 'SKU-1',
    });
  });

  it('vendor uses display_name with the vendor number chip', () => {
    expect(displayTitle('vendor', { id: ID, vendor_number: 'V-009', display_name: 'Acme Supply' })).toEqual({
      title: 'Acme Supply',
      number: 'V-009',
    });
  });

  it('member uses display_name with the member number chip', () => {
    expect(displayTitle('member', { id: ID, member_number: 'M-12', display_name: 'Jordan Lee' })).toEqual({
      title: 'Jordan Lee',
      number: 'M-12',
    });
  });

  it('lead and opportunity use display_name and have no number chip', () => {
    expect(displayTitle('lead', { id: ID, display_name: 'Big Box Retail' })).toEqual({ title: 'Big Box Retail', number: null });
    expect(displayTitle('opportunity', { id: ID, display_name: 'Q3 expansion' })).toEqual({ title: 'Q3 expansion', number: null });
  });

  it('work assignment uses its own title field', () => {
    expect(displayTitle('work_assignment', { id: ID, number: 'WA-3', title: 'Pack station 2 morning' })).toEqual({
      title: 'Pack station 2 morning',
      number: 'WA-3',
    });
  });
});

describe('displayTitle: transactional entities fall back to the number', () => {
  it('quote with no title shows the number as H1', () => {
    expect(displayTitle('quote', { id: ID, number: 'Q-2026-00008', title: null })).toEqual({
      title: 'Q-2026-00008',
      number: 'Q-2026-00008',
    });
  });

  it('quote with a blank title is treated as no title', () => {
    expect(displayTitle('quote', { id: ID, number: 'Q-2026-00008', title: '   ' })).toEqual({
      title: 'Q-2026-00008',
      number: 'Q-2026-00008',
    });
  });

  it('project with no name shows the number', () => {
    expect(displayTitle('project', { id: ID, number: 'PRJ-001', name: '' }).title).toBe('PRJ-001');
  });
});

describe('displayTitle: nameless entities derive from relations', () => {
  it('invoice derives from customer name, keeps invoice number as chip', () => {
    expect(displayTitle('invoice', { id: ID, invoice_number: 'INV-001' }, { customerName: 'Smoke Co.' })).toEqual({
      title: 'Smoke Co.',
      number: 'INV-001',
    });
  });

  it('invoice prefers customer name over project name', () => {
    expect(
      displayTitle('invoice', { id: ID, invoice_number: 'INV-001' }, { customerName: 'Smoke Co.', projectName: 'Relaunch' }).title,
    ).toBe('Smoke Co.');
  });

  it('invoice falls back to project name when no customer', () => {
    expect(displayTitle('invoice', { id: ID, invoice_number: 'INV-001' }, { projectName: 'Relaunch' }).title).toBe('Relaunch');
  });

  it('invoice with no relations falls back to its number', () => {
    expect(displayTitle('invoice', { id: ID, invoice_number: 'INV-001' }).title).toBe('INV-001');
  });

  it('payment derives from customer name, keeps payment number chip', () => {
    expect(displayTitle('payment', { id: ID, payment_number: 'PMT-7' }, { customerName: 'Smoke Co.' })).toEqual({
      title: 'Smoke Co.',
      number: 'PMT-7',
    });
  });

  it('credit note derives from customer name', () => {
    expect(displayTitle('credit_note', { id: ID, credit_note_number: 'CN-2' }, { customerName: 'Smoke Co.' }).title).toBe('Smoke Co.');
  });

  it('sales order prefers customer, then channel, then order number', () => {
    expect(displayTitle('sales_order', { id: ID, order_number: 'SO-1' }, { customerName: 'Smoke Co.' }).title).toBe('Smoke Co.');
    expect(displayTitle('sales_order', { id: ID, order_number: 'SO-1' }, { channelName: 'Shopify' }).title).toBe('Shopify');
    expect(displayTitle('sales_order', { id: ID, order_number: 'SO-1' }).title).toBe('SO-1');
  });

  it('fulfillment derives a label from the sales order number', () => {
    expect(displayTitle('fulfillment', { id: ID, fulfillment_number: 'FUL-1' }, { salesOrderNumber: 'SO-1' })).toEqual({
      title: 'Fulfillment for SO-1',
      number: 'FUL-1',
    });
  });

  it('receiving derives from the vendor name', () => {
    expect(displayTitle('receiving', { id: ID, receiving_number: 'RCV-1' }, { vendorName: 'Acme Supply' }).title).toBe('Acme Supply');
  });

  it('shipment derives from the customer name', () => {
    expect(displayTitle('shipment', { id: ID, shipment_number: 'SHP-1' }, { customerName: 'Smoke Co.' }).title).toBe('Smoke Co.');
  });

  it('manufacturing and job runs derive from item then template then run number', () => {
    expect(displayTitle('manufacturing_run', { id: ID, run_number: 'MR-1' }, { itemName: 'Gift box' }).title).toBe('Gift box');
    expect(displayTitle('job_run', { id: ID, run_number: 'JR-1' }, { templateName: 'Std kit' }).title).toBe('Std kit');
    expect(displayTitle('job_run', { id: ID, run_number: 'JR-1' }).title).toBe('JR-1');
  });

  it('kitting job derives from item then job number', () => {
    expect(displayTitle('kitting_job', { id: ID, job_number: 'KJ-1' }, { itemName: 'Gift box' }).title).toBe('Gift box');
    expect(displayTitle('kitting_job', { id: ID, job_number: 'KJ-1' }).title).toBe('KJ-1');
  });
});

describe('displayTitle: fallback to a short id prefix', () => {
  it('uses the 8-char id prefix when no name, relation, or number exists', () => {
    expect(displayTitle('invoice', { id: ID }).title).toBe('abc12345');
  });

  it('uses the id prefix when a customer name has not loaded yet', () => {
    // mid-flight: relation undefined, number present -> number wins over id prefix
    expect(displayTitle('invoice', { id: ID, invoice_number: 'INV-001' }, {}).title).toBe('INV-001');
    // mid-flight with neither relation nor number -> id prefix keeps the field diagnosable
    expect(displayTitle('shipment', { id: ID }, {}).title).toBe('abc12345');
  });

  it('returns an empty title only when there is no id and nothing else', () => {
    expect(displayTitle('customer', {}).title).toBe('');
  });
});

describe('formatCodeName', () => {
  it('joins code and name with a middot', () => {
    expect(formatCodeName('SKU-1', 'Widget')).toBe('SKU-1 · Widget');
  });

  it('returns the name alone when code is absent or blank', () => {
    expect(formatCodeName(null, 'Widget')).toBe('Widget');
    expect(formatCodeName('   ', 'Widget')).toBe('Widget');
    expect(formatCodeName(undefined, 'Widget')).toBe('Widget');
  });
});
