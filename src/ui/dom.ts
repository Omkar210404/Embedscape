// Tiny DOM helper. Text always goes in through textContent, never innerHTML.

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [type, fn] of Object.entries(props.on ?? {})) node.addEventListener(type, fn as EventListener);
  for (const c of children) if (c) node.append(c);
  return node;
}

export const fmt = (score: number) => score.toFixed(3);

let uid = 0;
export const nextId = (prefix: string) => `${prefix}-${++uid}`;
