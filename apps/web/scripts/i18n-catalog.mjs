import ts from "typescript";

/** Static alternatives at a translation call, including singular/plural
 * branches. Reading syntax also decodes escapes and ignores comments. */
function literals(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return literals(node.expression);
  }
  return [];
}

export function collectMessages(source, filename = "source.tsx") {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const keys = new Set();
  const indirect = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const args = node.arguments;
      const isRich = name === "rich" && args[0] && ts.isIdentifier(args[0]) && args[0].text === "t";
      if (name === "t" || name === "msg" || isRich) {
        const text = args[isRich ? 1 : 0];
        const values = literals(text);
        // t(text, "context"), t(text, vars, "context"), or
        // rich(t, text, nodes, "context") match the runtime API.
        const contexts = isRich ? literals(args[3]) : name === "t"
          ? (literals(args[1]).length ? literals(args[1]) : literals(args[2])) : [];
        for (const value of values) {
          if (!value.trim()) continue;
          for (const context of contexts.length ? contexts : [undefined]) {
            keys.add(context ? `${value}@@${context}` : value);
          }
        }
        if (name === "t" && text && !values.length) indirect.push(text.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { keys: [...keys], indirect };
}

/** A reviewer removes a key from status.machine after checking it. Never
 * replace that regional wording, or guess that an untracked edit is a draft.
 * Keep regional-only entries too; extraction reports obsolete keys for review. */
export function mergeDerivedMessages(derived, existing = {}, status = { machine: [] }) {
  const previousMachine = new Set(status.machine ?? []);
  const machine = new Set(previousMachine);
  const messages = { ...existing };
  for (const [key, value] of Object.entries(derived)) {
    if (Object.hasOwn(existing, key) && !machine.has(key)) continue;
    messages[key] = value;
    machine.add(key);
  }
  return {
    messages: Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a.localeCompare(b))),
    status: {
      ...status,
      machine: [
        ...[...previousMachine].filter((key) => Object.hasOwn(messages, key)),
        ...[...machine].filter((key) => !previousMachine.has(key)).sort(),
      ],
    },
  };
}
