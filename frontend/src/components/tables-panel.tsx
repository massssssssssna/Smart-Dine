'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, Plus, Users } from 'lucide-react';
import { api, ApiError, Page } from '@/lib/api';
import { Empty, Field, Modal } from './ui';
import { useConfirmation } from './use-confirmation';
import styles from './tables.module.css';

export type Floor = { id: string; name: string; version: number; table_count: number; total_seats: number };
export type DiningTable = { id: string; floor_id: string; name: string; seats: number; version: number; tax_rate?: number };

export async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await api<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || !page.items.length) return items;
  }
}

const floorLabel = (name?: string | null) => !name ? '' : /^floor\s/i.test(name) ? name : `Floor ${name}`;

export function TablePicker({ initial, disabled = false }: {
  initial?: { table_id?: string | null; floor_name_snapshot?: string | null; table_name_snapshot?: string | null; seats_snapshot?: number | null };
  disabled?: boolean;
}) {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floor, setFloor] = useState('');
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [table, setTable] = useState(initial?.table_id || '');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (disabled) return;
    void allPages<Floor>('floors').then(async found => {
      if (!active) return;
      setFloors(found);
      if (initial?.table_id) {
        for (const item of found) {
          const floorTables = await allPages<DiningTable>('tables?floor_id=' + item.id);
          if (!active) return;
          if (floorTables.some(candidate => candidate.id === initial.table_id)) {
            setFloor(item.id);
            return;
          }
        }
      }
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [disabled, initial?.table_id]);

  useEffect(() => {
    let active = true;
    setTables([]);
    if (floor) void allPages<DiningTable>('tables?floor_id=' + floor)
      .then(found => { if (active) { setTables(found); setError(''); } })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [floor]);

  if (disabled) return <p><strong>{[floorLabel(initial?.floor_name_snapshot), initial?.table_name_snapshot].filter(Boolean).join(' · ') || 'No table assigned'}</strong>{initial?.seats_snapshot ? ` · ${initial.seats_snapshot} seats` : ''}</p>;

  return <>
    <div className="form-grid">
      <Field label="Floor"><select aria-label="Floor" required value={floor} onChange={event => { setFloor(event.target.value); setTable(''); }}><option value="">Select floor…</option>{floors.map(item => <option key={item.id} value={item.id}>{floorLabel(item.name)}</option>)}</select></Field>
      <Field label="Table"><select aria-label="Table" required name="table_id" value={table} disabled={!floor} onChange={event => setTable(event.target.value)}><option value="">Select table…</option>{tables.map(item => <option key={item.id} value={item.id}>{item.name} · {item.seats} seats</option>)}</select></Field>
    </div>
    {!floors.length && <p className="muted">Ask the manager to add floors and tables first.</p>}
    {floor && !tables.length && <p className="muted">No tables on this floor yet.</p>}
    {error && <p className="error">{error}</p>}
  </>;
}

export function TablesPanel() {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [selected, setSelected] = useState('');
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ kind: 'floor' | 'table'; item?: Floor | DiningTable } | null>(null);
  const [floorTaxEditor, setFloorTaxEditor] = useState<Floor | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  const refresh = useCallback(async (preferred?: string) => {
    const found = await allPages<Floor>('floors');
    const next = preferred && found.some(item => item.id === preferred)
      ? preferred
      : found.some(item => item.id === selected) ? selected : found[0]?.id || '';
    setFloors(found);
    setSelected(next);
    setTables(next ? await allPages<DiningTable>('tables?floor_id=' + next) : []);
    setError('');
  }, [selected]);

  useEffect(() => {
    void refresh().catch(reason => setError(reason.message)).finally(() => setLoading(false));
    // Initial load only; actions refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const floor = floors.find(item => item.id === selected);

  function remove(kind: 'floor' | 'table', item: Floor | DiningTable) {
    confirm({
      title: `Delete ${kind}?`,
      description: kind === 'floor'
        ? `Delete Floor ${item.name}? Move or delete its tables first.`
        : `Delete ${item.name}? Existing receipts keep their table details. Active orders must be completed or cancelled first.`,
      label: `Delete ${kind}`,
      onConfirm: async () => {
        await api(kind === 'floor' ? 'floors/' + item.id : 'tables/' + item.id, 'DELETE', { expected_version: item.version }, crypto.randomUUID());
        await refresh();
      },
    });
  }

  return <section className="panel">
    {confirmationDialog}
    <div className="panel-head"><div><h2>Tables & floors</h2><p className="muted">All floors are shown below. Select one to manage its tables and seating.</p></div><button onClick={() => setEditor({ kind: 'floor' })}><Plus size={16} />Add floor</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <p>Loading floors…</p> : !floors.length ? <Empty>Add your first floor, then add its tables.</Empty> : <>
      <div className={styles.floorList}>{floors.map(item => <button type="button" key={item.id} className={`${styles.floorCard} ${selected === item.id ? styles.active : ''}`} onClick={() => void refresh(item.id)}><strong>{floorLabel(item.name)}</strong><span>{item.table_count} {item.table_count === 1 ? 'table' : 'tables'} · {item.total_seats} seats</span></button>)}</div>
      <div className="panel-head"><div><h3><Layers size={18} /> {floorLabel(floor?.name)}</h3><p className="muted">{floor?.table_count || 0} tables · {floor?.total_seats || 0} seats</p></div><div className="row-actions"><button className="soft" onClick={() => floor && setFloorTaxEditor(floor)}>Set floor tax %</button><button className="soft" onClick={() => setEditor({ kind: 'floor', item: floor })}>Edit floor</button><button className="danger-ghost" onClick={() => floor && remove('floor', floor)}>Delete floor</button><button onClick={() => setEditor({ kind: 'table' })}><Plus size={16} />Add table</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>Table</th><th>Seating capacity</th><th>Tax rate</th><th>Actions</th></tr></thead><tbody>{tables.map(item => <tr key={item.id}><td><strong>{item.name}</strong></td><td><Users size={16} /> {item.seats} seats</td><td><span className="badge active">{Number(item.tax_rate ?? 15)}% tax</span></td><td><div className="row-actions"><button className="soft" onClick={() => setEditor({ kind: 'table', item })}>Edit</button><button className="danger-ghost" onClick={() => remove('table', item)}>Delete</button></div></td></tr>)}</tbody></table></div>
      {!tables.length && <Empty>No tables on this floor. Add a table and choose how many people it seats.</Empty>}
    </>}
    {editor && <Modal title={`${editor.item ? 'Edit' : 'Add'} ${editor.kind}`} onClose={() => setEditor(null)}><LayoutForm kind={editor.kind} item={editor.item} floors={floors} selected={selected} onDone={async saved => { await refresh(editor.kind === 'floor' ? saved.id : selected); setEditor(null); }} /></Modal>}
    {floorTaxEditor && (
      <Modal title={`Set tax rate for ${floorLabel(floorTaxEditor.name)}`} onClose={() => setFloorTaxEditor(null)}>
        <FloorTaxForm floor={floorTaxEditor} onDone={async () => { await refresh(floorTaxEditor.id); setFloorTaxEditor(null); }} />
      </Modal>
    )}
  </section>;
}

function FloorTaxForm({ floor, onDone }: { floor: Floor; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form className="modal-form" onSubmit={async e => {
      e.preventDefault();
      setBusy(true);
      setError('');
      const form = new FormData(e.currentTarget);
      const tax_rate = Number(form.get('tax_rate'));
      try {
        await api(`floors/${floor.id}/tax`, 'PATCH', { tax_rate }, crypto.randomUUID());
        await onDone();
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <p className="muted">Set the standard tax percentage for all tables on <strong>{floorLabel(floor.name)}</strong>. This will be automatically applied when orders are booked.</p>
      <Field label="Floor tax rate (%)"><input name="tax_rate" type="number" required min={0} max={100} step={0.5} defaultValue={15} /></Field>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="full" disabled={busy}>{busy ? 'Updating…' : 'Apply tax rate to all floor tables'}</button>
    </form>
  );
}

function LayoutForm({ kind, item, floors, selected, onDone }: {
  kind: 'floor' | 'table'; item?: Floor | DiningTable; floors: Floor[]; selected: string;
  onDone: (saved: Floor | DiningTable) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const retry = useRef<{ body: string; key: string } | null>(null);

  return <form className="modal-form" onSubmit={async event => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const body = { name: form.get('name'), ...(kind === 'table' ? { floor_id: form.get('floor_id'), seats: Number(form.get('seats')), tax_rate: Number(form.get('tax_rate') ?? 15) } : {}), ...(item ? { expected_version: item.version } : {}) };
    const serialized = JSON.stringify(body);
    if (retry.current?.body !== serialized) retry.current = { body: serialized, key: crypto.randomUUID() };
    try {
      const saved = await api<Floor | DiningTable>((kind === 'floor' ? 'floors' : 'tables') + (item ? '/' + item.id : ''), item ? 'PUT' : 'POST', body, retry.current.key);
      await onDone(saved);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409
        ? kind === 'floor' ? `Floor ${String(form.get('name'))} already exists.` : 'A table with this name already exists on the selected floor.'
        : (reason as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }}>
    {kind === 'floor' ? <><Field label="Floor number"><input name="name" type="number" inputMode="numeric" required min={1} max={999} step={1} defaultValue={item?.name} placeholder="e.g. 2" /></Field><p className="muted small">Use numbers only: 1, 2, 3…</p></> : <Field label="Table name / number"><input name="name" required maxLength={80} defaultValue={item?.name} placeholder="e.g. Table 3" /></Field>}
    {kind === 'table' && <>
      <Field label="Floor"><select name="floor_id" required defaultValue={(item as DiningTable)?.floor_id || selected}>{floors.map(candidate => <option key={candidate.id} value={candidate.id}>{floorLabel(candidate.name)}</option>)}</select></Field>
      <div className="form-grid">
        <Field label="Seats"><input name="seats" type="number" required min={1} max={100} step={1} defaultValue={(item as DiningTable)?.seats || 4} /></Field>
        <Field label="Tax rate (%)"><input name="tax_rate" type="number" required min={0} max={100} step={0.5} defaultValue={(item as DiningTable)?.tax_rate ?? 15} /></Field>
      </div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    <button className="full" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
  </form>;
}
