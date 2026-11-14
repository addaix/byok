/**
 * byok's React parts. Entry `byok/react`.
 *
 * - `KeyField`: one service's key. Typed into an uncontrolled password field and read once, on
 *   Save, through a ref: never in a `value` attribute, React state or a draft, and browsers and
 *   password managers are asked not to offer to save it. Once saved it is shown masked, with
 *   Replace and Forget.
 * - `OtherKeys`: every other key stored, each with its own Forget.
 * - `ByokPanel`: byok's own settings panel over its own store (the "own" wiring): service, model
 *   with its price, the key, other keys, and Undo after Forget.
 *
 * The parts are driven by props, so a host with its own settings state uses `KeyField` and
 * `OtherKeys` as they are and keeps its own store. `Button` is a slot: pass the app's button to
 * keep its press feedback; the default shows a pending state and ignores repeat presses.
 */
import * as React from 'react';
import { CATALOG, modelChoice, serviceInfo, servicesOf } from '../catalog';
import { priceLine } from '../estimate';
import { createByokStore, type ByokStore, type ByokView } from '../store';
import type { Catalog, SecretRef, ServiceId, ServiceInfo } from '../types';

export interface ByokButtonProps {
  onPress: () => unknown;
  children: React.ReactNode;
  variant: 'primary' | 'secondary' | 'link' | 'danger';
  /** The spoken name, when the visible one needs context ("Forget this Anthropic key"). */
  label?: string;
}

/**
 * The default button (tw-frontend-ux, press and touch): pressed from `pointerdown`, acts on `click`,
 * and while what it started runs it is pending (`aria-busy`, `aria-disabled`, not `disabled`, which
 * would drop focus) and ignores repeat presses. `@zodal/ui`'s `usePress` replaces this once a
 * version that has it is on npm.
 */
export function DefaultButton({ onPress, children, variant, label }: ByokButtonProps) {
  const [pending, setPending] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const inFlight = React.useRef(false); // the guard, set in the same event (state lags a frame)
  const release = () => setPressed(false);
  return (
    <button
      type="button"
      className={`byok-button byok-${variant}`}
      aria-label={label}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      data-pressed={pressed ? '' : undefined}
      data-pending={pending ? '' : undefined}
      onPointerDown={(e) => e.button === 0 && setPressed(true)}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onClick={async () => {
        if (inFlight.current) return;
        const result = onPress();
        if (!(result instanceof Promise)) return;
        inFlight.current = true;
        setPending(true);
        try {
          await result;
        } finally {
          inFlight.current = false;
          setPending(false);
        }
      }}
    >
      {children}
    </button>
  );
}

/** "an Anthropic key", "a Google key". */
const an = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');

export interface KeyFieldProps {
  service: ServiceInfo;
  /** Whether a key is stored (masked); null while unknown. */
  keyRef: SecretRef | null;
  /** Store the typed key. Resolve to false when it was not stored (the field keeps the text). */
  onSave: (key: string) => Promise<unknown>;
  onForget: () => unknown;
  /** The field's label (default "Your <service> key"). */
  label?: string;
  /** The input's id (default "byok-key"). */
  id?: string;
  /** Where the key is kept and where it goes, as the page should say it. */
  where?: React.ReactNode;
  Button?: React.ComponentType<ByokButtonProps>;
}

export function KeyField({ service, keyRef, onSave, onForget, label, id = 'byok-key', where, Button = DefaultButton }: KeyFieldProps) {
  const input = React.useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = React.useState(false);
  const [empty, setEmpty] = React.useState(true); // only whether something is typed, never what
  React.useEffect(() => setReplacing(false), [service.id]);
  const editing = !keyRef?.isSet || replacing;
  const whereLine = (
    <p className="byok-help">{where ?? `Kept only in this browser. Sent only to ${service.name}, when you use it.`}</p>
  );
  const save = async () => {
    const typed = input.current?.value ?? '';
    if (!typed.trim()) return;
    if ((await onSave(typed)) === false) return;
    if (input.current) input.current.value = '';
    setEmpty(true);
    setReplacing(false);
  };
  return (
    <div className="byok-field byok-key-field">
      <label htmlFor={id}>{label ?? `Your ${service.name} key`}</label>
      {editing ? (
        <>
          <div className="byok-row">
            {/* Uncontrolled: the typed key is read once through the ref, never kept in a value attribute or state. */}
            <input
              id={id}
              ref={input}
              className="byok-input"
              type="password"
              name={`byok-${service.id}-key`}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore=""
              data-lpignore="true"
              data-form-type="other"
              placeholder={service.keyPlaceholder}
              onInput={(e) => setEmpty(!(e.target as HTMLInputElement).value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            <Button variant={empty ? 'secondary' : 'primary'} onPress={save}>
              Save key
            </Button>
            {replacing && (
              <Button variant="link" onPress={() => setReplacing(false)}>
                Keep the saved key
              </Button>
            )}
          </div>
          {whereLine}
          <p className="byok-help">
            <a href={service.keyUrl} target="_blank" rel="noopener noreferrer">
              Get {an(service.name)} {service.name} key
            </a>
          </p>
        </>
      ) : (
        <>
          <div className="byok-row">
            <span className="byok-masked" id={id} tabIndex={-1}>
              {keyRef?.masked}
            </span>
            <Button variant="secondary" onPress={() => setReplacing(true)}>
              Replace
            </Button>
            <Button variant="danger" onPress={onForget} label={`Forget this ${service.name} key`}>
              Forget this key
            </Button>
          </div>
          {whereLine}
        </>
      )}
    </div>
  );
}

export interface OtherKeysProps {
  /** Every service that may hold a key. */
  services: readonly ServiceInfo[];
  keys: Partial<Record<ServiceId, SecretRef>> | null;
  /** The service chosen now (its key is in the `KeyField`, not here). */
  chosen: ServiceId;
  onForget: (service: ServiceId) => unknown;
  Button?: React.ComponentType<ByokButtonProps>;
}

/** Keys of the services not chosen now, still stored: each with its own Forget. */
export function OtherKeys({ services, keys, chosen, onForget, Button = DefaultButton }: OtherKeysProps) {
  const others = services.filter((s) => s.id !== chosen && keys?.[s.id]?.isSet);
  if (!others.length) return null;
  return (
    <div className="byok-field">
      <span className="byok-label">Other keys on this device</span>
      {others.map((s) => (
        <div key={s.id} className="byok-row">
          <span>
            {s.name} key <span className="byok-masked">{keys![s.id]!.masked}</span>
          </span>
          <Button variant="danger" onPress={() => onForget(s.id)} label={`Forget this ${s.name} key`}>
            Forget this key
          </Button>
        </div>
      ))}
    </div>
  );
}

/** How long Undo is offered after a key is forgotten, in milliseconds. */
export const UNDO_MS = 15_000;

export interface ByokPanelProps {
  /** Where the settings live (default: byok's own store in this browser). */
  store?: ByokStore;
  catalog?: Catalog;
  Button?: React.ComponentType<ByokButtonProps>;
  /** How long Undo is offered after Forget (default `UNDO_MS`). */
  undoMs?: number;
}

type Loaded = { status: 'loading' } | { status: 'error'; reason: string } | { status: 'ready'; view: ByokView };

/** byok's own settings panel: which service, which model, and the keys. */
export function ByokPanel({ store, catalog = CATALOG, Button = DefaultButton, undoMs = UNDO_MS }: ByokPanelProps) {
  const own = React.useMemo(() => store ?? createByokStore({ catalog }), [store, catalog]);
  const [loaded, setLoaded] = React.useState<Loaded>({ status: 'loading' });
  const [note, setNote] = React.useState('');
  const [undo, setUndo] = React.useState<null | { service: ServiceId; restore: () => Promise<unknown> }>(null);
  const reload = React.useCallback(async () => {
    try {
      setLoaded({ status: 'ready', view: await own.load() });
    } catch {
      setLoaded({ status: 'error', reason: 'Could not read the AI settings in this browser.' });
    }
  }, [own]);
  React.useEffect(() => void reload(), [reload]);
  React.useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), undoMs); // the key is let go only now
    return () => clearTimeout(timer);
  }, [undo, undoMs]);

  if (loaded.status === 'loading') return <p className="byok-help" aria-busy="true">Loading the AI settings…</p>;
  if (loaded.status === 'error') return <p className="byok-error">{loaded.reason}</p>;
  const { values, keys } = loaded.view;
  const services = servicesOf(catalog).map((id) => serviceInfo(id, catalog));
  const chosen = serviceInfo(values['text.service'], catalog);
  const model = modelChoice(chosen.id, values['text.model'], catalog);

  const save = async (patch: Parameters<ByokStore['save']>[0]) => {
    await own.save(patch);
    await reload();
  };
  const forget = async (service: ServiceId) => {
    const held = await own.revealKey(service); // kept in memory only while Undo is offered
    await own.forgetKey(service);
    await reload();
    const name = serviceInfo(service, catalog).name;
    setNote(`Forgot the ${name} key.`);
    setUndo({ service, restore: () => own.setKey(service, held) });
  };

  return (
    <div className="byok-panel">
      <div className="byok-field">
        <label htmlFor="byok-service">AI service</label>
        <select id="byok-service" className="byok-select" value={chosen.id} onChange={(e) => void save({ 'text.service': e.target.value as ServiceId, 'text.model': '' })}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="byok-field">
        <label htmlFor="byok-model">Model</label>
        <select id="byok-model" className="byok-select" value={model.id === chosen.models[0]!.id ? '' : model.id} onChange={(e) => void save({ 'text.model': e.target.value })}>
          {chosen.models.map((m, i) => (
            <option key={m.id} value={i === 0 ? '' : m.id}>
              {m.label}
              {i === 0 ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <p className="byok-help">
          {model.note}. {priceLine(model)}
        </p>
      </div>
      <KeyField
        service={chosen}
        keyRef={keys[chosen.id] ?? null}
        Button={Button}
        onSave={async (key) => {
          await own.setKey(chosen.id, key);
          await reload();
          setNote(`Saved the ${chosen.name} key.`);
        }}
        onForget={() => forget(chosen.id)}
      />
      <OtherKeys services={services} keys={keys} chosen={chosen.id} onForget={forget} Button={Button} />
      <p role="status" className="byok-help">
        {note}
        {undo && (
          <>
            {' '}
            <Button
              variant="link"
              onPress={async () => {
                const { restore } = undo;
                setUndo(null);
                await restore();
                await reload();
                setNote('Key restored.');
              }}
            >
              Undo
            </Button>
          </>
        )}
      </p>
    </div>
  );
}
