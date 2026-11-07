'use client';

import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { Badge, Button, Field, Input, Modal, Select, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { rwf } from '@/lib/format';

/** Collection status as staff see it. */
export function CollectionBadge({ status }: { status: string }) {
  return status === 'collected' ? <Badge tone="neutral">Collected</Badge> : status === 'requested' ? <Badge tone="warning">Collection requested</Badge> : <Badge tone="good">In storage</Badge>;
}


export function PayDialog({ collection, onClose, onDone }: { collection: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const can = useCan();
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (status: 'paid' | 'waived') => {
    setBusy(true);
    setError(null);
    try {
      await api(`collections/${collection.id}/payment`, { method: 'POST', body: { status, method, reference } });
      toast(status === 'paid' ? 'Payment recorded' : 'Charge waived');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Storage charge: ${rwf(collection.chargeRwf)}`} footer={<>{can() && <Button variant="ghost" onClick={() => send('waived')} disabled={busy}>Waive</Button>}<Button variant="primary" onClick={() => send('paid')} loading={busy}>Mark as paid</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid by" htmlFor="pm"><Select id="pm" value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="momo">Mobile money</option><option value="bank">Bank</option><option value="other">Other</option></Select></Field>
        <Field label="Reference" htmlFor="pr" hint="Transaction number, if any"><Input id="pr" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
