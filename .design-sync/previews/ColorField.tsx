import { useState } from 'react';
import { ColorField } from 'kitstak-ui';

export function BrandNavy() {
  const [value, setValue] = useState('#0a1628');
  return <ColorField label="Brand navy" name="brand-navy" value={value} onChange={setValue} />;
}

export function AccentRed() {
  const [value, setValue] = useState('#c8102e');
  return <ColorField label="Accent" name="accent" value={value} onChange={setValue} />;
}

export function WithError() {
  const [value, setValue] = useState('#12xz');
  return (
    <ColorField
      label="Header background"
      name="header-bg"
      value={value}
      onChange={setValue}
      error="Enter a valid hex colour, for example #0a1628"
    />
  );
}

export function NoLabel() {
  const [value, setValue] = useState('#f5f1e8');
  return <ColorField name="surface" value={value} onChange={setValue} />;
}
