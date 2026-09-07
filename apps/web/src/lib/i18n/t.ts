/**
 * The translation function, and the whole of the translation model.
 *
 * English is the key. A component writes `t("Market cap")` and a locale's
 * message file maps that English to its translation. There are no invented
 * identifiers, no nesting and no dictionary to design: writing a new string
 * is writing English, and changing the English changes the key, which is
 * correct — the old translation is stale, so it falls back to English until
 * the draft script re-translates it.
 *
 * Interpolation is `{name}` with values passed in. Plurals barely arise:
 * Japanese and Chinese have none, Spanish and French pluralise as English
 * does, so an English string chosen by `n === 1` keeps working translated.
 * The rare English word that means two things in two places gets a context
 * suffix in the source, `t("All", "window")`, which the catalog keys on and
 * the reader never sees.
 */
export type Messages = Record<string, string>;

export type Vars = Record<string, string | number>;

export type T = (text: string, vars?: Vars | string, context?: string) => string;

/** How a context-qualified source string is keyed in a message file:
 *  `"All@@window"`. The separator never occurs in real copy, and a reviewer
 *  who sees it knows the word needed disambiguating. */
export function messageKey(text: string, context?: string): string {
  return context ? `${text}@@${context}` : text;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** A `t` bound to one locale's messages. English passes an empty map. */
export function makeT(messages: Messages): T {
  return (text, vars, context) => {
    // `t("All", "window")` — a bare string second argument is a context.
    const ctx = typeof vars === "string" ? vars : context;
    const values = typeof vars === "string" ? undefined : vars;
    const translated = messages[messageKey(text, ctx)] ?? text;
    return interpolate(translated, values);
  };
}

/**
 * Marks English that is translated later, not here: a label in a constant
 * array that a component renders through `t(item.label)`. The extractor
 * collects `msg("...")` exactly as it collects `t("...")`; at runtime this
 * returns its argument, which is what the later `t` call keys on.
 */
export const msg = (text: string): string => text;
