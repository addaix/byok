// @vitest-environment jsdom
/**
 * The key field, rendered: the typed key is never in an attribute of the page (a `value` attribute
 * would put it in the DOM, a saved page, a bug report's HTML), nor in the page's state, and the
 * field asks browsers and password managers not to offer to save it. Forget has an Undo.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ByokPanel } from '../src/react';
import { memoryStore } from './helpers';

const KEY = 'sk-ant-invented-SECRETSECRET-0000';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every attribute value of every element under `root`, joined. */
const allAttributes = (root: Element) =>
  [root, ...root.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => `${a.name}=${a.value}`)).join('\n');
const button = (container: Element, text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('ByokPanel and its key field', () => {
  it('never carries the typed key in an attribute or the DOM, and is not offered to password managers', async () => {
    const { store, secretsProvider } = memoryStore();
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    const input = container.querySelector<HTMLInputElement>('#byok-key')!;
    expect(input).not.toBeNull();
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.hasAttribute('data-1p-ignore')).toBe(true);
    expect(input.getAttribute('data-lpignore')).toBe('true');
    expect(input.getAttribute('spellcheck')).toBe('false');

    await act(async () => {
      input.value = KEY; // what typing does to the field
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(allAttributes(container)).not.toContain('SECRET');
    expect(container.innerHTML).not.toContain('SECRET');

    await act(async () => button(container, 'Save key')!.click());
    await settle();
    expect(container.textContent).toContain('•••• (set)');
    expect(container.innerHTML).not.toContain('SECRET');
    expect(JSON.stringify(await secretsProvider.getList({}))).toContain('SECRET'); // stored, where it belongs
  });

  it('lists the other stored keys, each with its own Forget, and offers Undo after Forget', async () => {
    const { store } = memoryStore();
    await store.setKey('anthropic', KEY);
    await store.setKey('openai', 'sk-proj-SECRET-2');
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    expect(container.textContent).toContain('Other keys on this device');
    expect(container.textContent).toContain('OpenAI key');

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Forget this Anthropic key"]')!.click());
    await settle();
    expect((await store.load()).keys.anthropic?.isSet).toBe(false);
    expect(container.textContent).toContain('Forgot the Anthropic key.');
    expect(container.innerHTML).not.toContain('SECRET');

    await act(async () => button(container, 'Undo')!.click());
    await settle();
    expect(await store.revealKey('anthropic')).toBe(KEY);
    expect(container.textContent).toContain('Key restored.');
  });

  it('switching the service resets the model to that service\'s default, and shows its price line', async () => {
    const { store } = memoryStore();
    await store.save({ 'text.model': 'claude-haiku-5-5' });
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    expect(container.textContent).toContain('$0.1 per million tokens sent');
    const select = container.querySelector<HTMLSelectElement>('#byok-service')!;
    await act(async () => {
      select.value = 'openai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(await store.values()).toEqual({ 'text.service': 'openai', 'text.model': '' });
    expect(container.textContent).toContain('cost not estimated');
    expect(container.textContent).toContain('Get an OpenAI key');
  });
});
