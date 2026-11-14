/**
 * byok's React parts. Entry `byok/react`.
 *
 * - `KeyField`: one service's key. Typed into an uncontrolled password field and read once, on
 *   Save (or Enter), through a ref: never in a `value` attribute, the page's HTML, React state or a
 *   draft, and browsers and password managers are asked not to offer to save it. Once saved it is
 *   shown masked, with Replace and Forget. The field is emptied whenever the service changes, so a
 *   key typed for one service is never saved as another's.
 * - `OtherKeys`: every other key stored, each with its own Forget.
 * - `ByokPanel`: byok's own settings panel over its own store (the "own" wiring): service, model
 *   with its price, the key, other keys, and Undo for a while after Forget.
 *
 * The parts are driven by props, so a host with its own settings state uses `KeyField` and
 * `OtherKeys` as they are and keeps its own store. `Button` is a slot: pass the app's button to
 * keep its press feedback; the default shows a pending state and ignores repeat presses.
 */
import * as React from 'react';
import { modelChoice, serviceInfo, servicesOf } from '../catalog';
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
        } catch {
          // the caller reports its own failure; the button only stops being pending
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
  /** Store the typed key. Resolve to false, or throw, when it was not stored: the field keeps the text. */
  onSave: (key: string) => Promise<unknown>;
  onForget: () => unknown;
  /** The field's label (default "Your <service> key"). */
  label?: string;
  /** The input's id (default "byok-key"). */
  id?: string;
  /**
   * Where the key is kept, as the person should be told it (a store's `where`). Left out, the field
   * says only where the key is sent.
   */
  where?: string;
  Button?: React.ComponentType<ByokButtonProps>;
}

export function KeyField({ service, keyRef, onSave, onForget, label, id = 'byok-key', where, Button = DefaultButton }: KeyFieldProps) {
  const input = React.useRef<HTMLInputElement>(null);
  const masked = React.useRef<HTMLSpanElement>(null);
  const busy = React.useRef(false); // one guard for Save and Enter
  const focusNext = React.useRef<'input' | 'masked' | null>(null);
  const [replacing, setReplacing] = React.useState(false);
  const [empty, setEmpty] = React.useState(true); // only whether something is typed, never what
  const [problem, setProblem] = React.useState('');
  React.useEffect(() => {
    // Another service: whatever was typed belonged to the previous one.
    if (input.current) input.current.value = '';
    setEmpty(true);
    setReplacing(false);
    setProblem('');
  }, [service.id]);
  const editing = !keyRef?.isSet || replacing;
  React.useEffect(() => {
    const target = focusNext.current === 'input' ? input.current : focusNext.current === 'masked' ? masked.current : null;
    focusNext.current = null;
    target?.focus();
  });

  const save = async () => {
    if (busy.current) return;
    const typed = input.current?.value ?? '';
    if (!typed.trim()) {
      setProblem('Paste your key first.');
      input.current?.focus();
      return;
    }
    busy.current = true;
    setProblem('');
    try {
      if ((await onSave(typed)) === false) return;
      if (input.current) input.current.value = '';
      setEmpty(true);
      setReplacing(false);
      focusNext.current = 'masked';
    } catch {
      setProblem('Could not save the key. It is still in the field; try again.');
    } finally {
      busy.current = false;
    }
  };
  const sentTo = `Sent only to ${service.name}, when you use it.`;
  const whereLine = <p className="byok-help">{where ? `${where} ${sentTo}` : sentTo}</p>;
  const alert = problem ? (
    <p role="alert" className="byok-error">
      {problem}
    </p>
  ) : null;
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
              onInput={(e) => {
                setEmpty(!(e.target as HTMLInputElement).value.trim());
                setProblem('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            <Button variant={empty ? 'secondary' : 'primary'} onPress={save}>
              Save key
            </Button>
            {replacing && (
              <Button
                variant="link"
                onPress={() => {
                  setReplacing(false);
                  focusNext.current = 'masked';
                }}
              >
                Keep the saved key
              </Button>
            )}
          </div>
          {alert}
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
            <span className="byok-masked" id={id} ref={masked} tabIndex={-1}>
              {keyRef?.masked}
            </span>
            <Button
              variant="secondary"
              onPress={() => {
                setReplacing(true);
                focusNext.current = 'input';
              }}
            >
              Replace
            </Button>
            <Button
              variant="danger"
              label={`Forget this ${service.name} key`}
              onPress={() => {
                focusNext.current = 'input';
                return onForget();
              }}
            >
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
      <span className="byok-label">Other keys kept here</span>
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
  /** Where the settings live (default: byok's own store in this browser, made once). */
  store?: ByokStore;
  /** The services offered, when no `store` is passed (a store brings its own). */
  catalog?: Catalog;
  Button?: React.ComponentType<ByokButtonProps>;
  /** How long Undo is offered after Forget (default `UNDO_MS`). */
  undoMs?: number;
}

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; view: ByokView };

/** byok's own settings panel: which service, which model, and the keys. */
export function ByokPanel({ store, catalog, Button = DefaultButton, undoMs = UNDO_MS }: ByokPanelProps) {
  const fallback = React.useRef<ByokStore | null>(null);
  const own = store ?? (fallback.current ??= createByokStore(catalog ? { catalog } : {}));
  const [loaded, setLoaded] = React.useState<Loaded>({ status: 'loading' });
  const [note, setNote] = React.useState('');
  const [problem, setProblem] = React.useState('');
  // Undo after Forget: which service, in state; the key itself only in a ref, let go when Undo ends.
  const [undo, setUndo] = React.useState<{ service: ServiceId; name: string } | null>(null);
  const held = React.useRef<string>('');
  const endUndo = React.useCallback(() => {
    held.current = '';
    setUndo(null);
  }, []);

  const reload = React.useCallback(async () => {
    try {
      setLoaded({ status: 'ready', view: await own.load() });
    } catch {
      setLoaded({ status: 'error' });
    }
  }, [own]);
  React.useEffect(() => void reload(), [reload]);
  React.useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(endUndo, undoMs);
    return () => clearTimeout(timer);
  }, [undo, undoMs, endUndo]);
  React.useEffect(() => () => void (held.current = ''), []);

  if (loaded.status === 'loading') return <p className="byok-help" aria-busy="true">Loading the AI settings…</p>;
  if (loaded.status === 'error') {
    return (
      <div className="byok-panel">
        <p role="alert" className="byok-error">
          Could not read the AI settings.
        </p>
        <Button variant="secondary" onPress={reload}>
          Try again
        </Button>
      </div>
    );
  }
  const { values, keys } = loaded.view;
  const cat = own.catalog;
  const services = servicesOf(cat).map((id) => serviceInfo(id, cat));
  const chosen = serviceInfo(values['text.service'], cat);
  const model = modelChoice(chosen.id, values['text.model'], cat);

  /** Run a change: shown at once, then saved; on failure the page goes back and says so. */
  const change = async (shown: Partial<ByokView['values']>, act: () => Promise<unknown>, failure: string) => {
    setProblem('');
    setLoaded({ status: 'ready', view: { keys, values: { ...values, ...shown } } });
    try {
      await act();
    } catch {
      setProblem(failure);
    }
    await reload();
  };
  const forget = async (service: ServiceId) => {
    const name = serviceInfo(service, cat).name;
    try {
      held.current = await own.revealKey(service); // kept only while Undo is offered
      await own.forgetKey(service);
      setNote(`Forgot the ${name} key.`);
      setUndo({ service, name });
    } catch {
      held.current = '';
      setProblem(`Could not forget the ${name} key. Try again.`);
    }
    await reload();
  };
  const modelValue = model.id === chosen.models[0]!.id ? '' : model.id;
  const modelHelp = [model.note && `${model.note.replace(/\.$/, '')}.`, priceLine(model)].filter(Boolean).join(' ');

  return (
    <div className="byok-panel">
      <div className="byok-field">
        <label htmlFor="byok-service">AI service</label>
        <select
          id="byok-service"
          className="byok-select"
          value={chosen.id}
          onChange={(e) => {
            const service = e.target.value as ServiceId;
            endUndo();
            setNote('');
            void change({ 'text.service': service, 'text.model': '' }, () => own.save({ 'text.service': service, 'text.model': '' }), 'Could not save the AI service.');
          }}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="byok-field">
        <label htmlFor="byok-model">Model</label>
        <select
          id="byok-model"
          className="byok-select"
          value={modelValue}
          onChange={(e) => {
            const next = e.target.value;
            void change({ 'text.model': next }, () => own.save({ 'text.model': next }), 'Could not save the model.');
          }}
        >
          {!chosen.models.some((m) => m.id === model.id) && <option value={model.id}>{model.label}</option>}
          {chosen.models.map((m, i) => (
            <option key={m.id} value={i === 0 ? '' : m.id}>
              {m.label}
              {i === 0 ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <p className="byok-help">{modelHelp}</p>
      </div>
      <KeyField
        key={chosen.id}
        service={chosen}
        keyRef={keys[chosen.id] ?? null}
        where={own.where}
        Button={Button}
        onSave={async (key) => {
          await own.setKey(chosen.id, key);
          endUndo(); // an Undo now would put an older key back over this one
          await reload();
          setNote(`Saved the ${chosen.name} key.`);
        }}
        onForget={() => forget(chosen.id)}
      />
      <OtherKeys services={services} keys={keys} chosen={chosen.id} onForget={forget} Button={Button} />
      {problem && (
        <p role="alert" className="byok-error">
          {problem}
        </p>
      )}
      <p role="status" className="byok-help">
        {note}
        {undo && (
          <>
            {' '}
            <Button
              variant="link"
              label={`Undo forgetting the ${undo.name} key`}
              onPress={async () => {
                const { service, name } = undo;
                const key = held.current;
                endUndo();
                try {
                  if (key) await own.setKey(service, key);
                  setNote(`Restored the ${name} key.`);
                } catch {
                  setProblem(`Could not restore the ${name} key.`);
                }
                await reload();
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
