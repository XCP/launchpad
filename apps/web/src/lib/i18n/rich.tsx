import { Fragment, type ReactNode } from "react";
import type { T, Vars } from "@/lib/i18n/t";

/**
 * A translated sentence with markup inside it.
 *
 * Prose splits sentences around inline code and links, and translating the
 * fragments separately breaks the sentence in any language whose word
 * order differs from English — which is every language this site is going
 * to. So the sentence stays whole as one key, with a placeholder where the
 * markup goes, and the markup is passed in as a node:
 *
 *   rich(t, "Call {compose} once per launch.", { compose: <code>compose</code> })
 *
 * The translator sees "{compose}" and moves it where the sentence needs it.
 * Plain values are interpolated as usual; only node-valued placeholders are
 * split out. Works in server and client components alike, since it is only
 * a function over the `t` it is given.
 */
export function rich(
  t: T,
  text: string,
  values: Record<string, ReactNode | string | number>,
  context?: string,
): ReactNode {
  const plain: Vars = {};
  const nodes: Record<string, ReactNode> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number") plain[name] = value;
    else nodes[name] = value;
  }
  const translated = t(text, plain, context);
  const parts = translated.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\{(\w+)\}$/);
        if (m && m[1]! in nodes) return <Fragment key={i}>{nodes[m[1]!]}</Fragment>;
        return part;
      })}
    </>
  );
}
