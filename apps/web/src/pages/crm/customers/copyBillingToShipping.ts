// F-Wave9-AUDIT-V3-WAVE-E-01 (item 3): pure helper for the
// "Same as billing" checkbox on CustomerCreatePage. The page holds
// each address line as a separate useState (line1, line2, city,
// region, postal, country). When the operator toggles the checkbox
// ON, we copy each billing field into the matching shipping field
// at that instant. Once the operator types into a shipping field,
// the checkbox un-checks itself; we never silently overwrite a
// manually edited shipping field.
//
// Storage shape is unchanged: each field is still its own string,
// and CustomerCreateSchema's shipping_address validator still sees
// the same Address object.

export interface AddressFields {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
}

/**
 * Returns the billing fields verbatim. Pure: caller decides when to
 * apply (only on checkbox toggle ON, not on every billing-field
 * keystroke, which would clobber manual shipping edits).
 */
export function copyBillingToShipping(billing: AddressFields): AddressFields {
  return {
    line1: billing.line1,
    line2: billing.line2,
    city: billing.city,
    region: billing.region,
    postal: billing.postal,
    country: billing.country,
  };
}

/**
 * Returns true when the two address-field bundles are byte-equal
 * across every field. Used by the page to decide whether a manual
 * shipping edit has drifted the form away from "same as billing"
 * and the checkbox should un-check.
 */
export function addressesEqual(
  a: AddressFields,
  b: AddressFields,
): boolean {
  return (
    a.line1 === b.line1 &&
    a.line2 === b.line2 &&
    a.city === b.city &&
    a.region === b.region &&
    a.postal === b.postal &&
    a.country === b.country
  );
}
