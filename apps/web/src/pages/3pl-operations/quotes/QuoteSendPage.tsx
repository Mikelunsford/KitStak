import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { useQuote, useSendQuote } from '@/lib/hooks/useQuotes';

export function QuoteSendPage() {
  const { id } = useParams();
  const { data } = useQuote(id);
  const send = useSendQuote();
  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">SEND QUOTE</h1>
      <p className="text-ink-dim">
        Sending marks the quote as sent_at. PDF email wiring lands when the pdf-worker is online.
      </p>
      {data && (
        <p className="text-ink">Quote {data.quote.number}, total in {data.quote.currency_code}.</p>
      )}
      <Button onClick={() => id && send.mutate(id)} disabled={send.isPending || !id}>
        {send.isPending ? 'Sending.' : 'Mark sent'}
      </Button>
      {send.error && (
        <p className="font-sans text-sm text-accent">
          {send.error instanceof Error ? send.error.message : 'Send failed.'}
        </p>
      )}
    </section>
  );
}
