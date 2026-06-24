import { useState } from 'react';
import { CurrencyField } from 'kitstak-ui';

// CurrencyField loads the org currency list and default from the settings
// store. In the preview environment that backend is stubbed empty, so the
// control falls back to its single seeded option (the value passed in) and
// renders the default-only state.
export function Default() {
  const [code, setCode] = useState('USD');
  return <CurrencyField value={code} onChange={setCode} />;
}

export function CustomLabel() {
  const [code, setCode] = useState('CAD');
  return <CurrencyField label="Invoice currency" value={code} onChange={setCode} />;
}

export function Disabled() {
  return <CurrencyField label="Currency" value="EUR" onChange={() => {}} disabled />;
}
