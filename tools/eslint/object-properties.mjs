import { findVariable, propertyName } from "./bindings.mjs";

const missing = Symbol("known absent property");

function boundObject(sourceCode, pattern, value, name, seen) {
  if (pattern.type === "Identifier") {
    return pattern.name === name ? resolveObject(sourceCode, value, seen) : undefined;
  }
  if (pattern.type === "AssignmentPattern") {
    return boundObject(sourceCode, pattern.left, value === missing ? pattern.right : value, name, seen);
  }
  if (pattern.type !== "ObjectPattern") return;
  const object = resolveObject(sourceCode, value, seen);
  if (!object) return;
  const excluded = new Set();
  for (const property of pattern.properties) {
    if (property.type === "RestElement") {
      if (property.argument.name !== name || excluded.has(undefined)) return;
      return {
        complete: object.complete,
        entries: new Map([...object.entries].filter(([key]) => !excluded.has(key))),
      };
    }
    const key = propertyName(property);
    excluded.add(key);
    if (key === undefined) continue;
    const entry = object.entries.get(key);
    let selected = entry?.value;
    // Unknown spreads/getters may provide the property: do not assume a
    // destructuring default will run. Prototype properties are not absent.
    if (!entry && object.complete && !(key in Object.prototype)) selected = missing;
    const result = boundObject(sourceCode, property.value, selected, name, new Set(seen));
    if (result) return result;
  }
}

function resolveObject(sourceCode, node, seen) {
  if (!node) return;
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    return resolveObject(sourceCode, node.expression, seen);
  }
  if (node.type === "Identifier") {
    const variable = findVariable(sourceCode, node, node.name);
    if (!variable || seen.has(variable)) return;
    const definition = variable.defs[0];
    if (definition?.type !== "Variable" || definition.parent.kind !== "const") return;
    const nextSeen = new Set(seen).add(variable);
    return boundObject(sourceCode, definition.node.id, definition.node.init, node.name, nextSeen);
  }
  if (node.type !== "ObjectExpression") return;
  const entries = new Map();
  let complete = true;
  const invalidateValues = () => {
    complete = false;
    // A later unknown property/spread can overwrite earlier values, but cannot
    // remove their keys. Retain names for direct JSX spreads, not value guesses.
    for (const [key, entry] of entries) entries.set(key, { ...entry, value: undefined });
  };
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      const spread = resolveObject(sourceCode, property.argument, new Set(seen));
      if (!spread?.complete) invalidateValues();
      if (spread) {
        for (const [key, entry] of spread.entries) entries.set(key, entry);
      }
      continue;
    }
    const name = propertyName(property);
    if (name === undefined || (name === "__proto__" && !property.computed && !property.shorthand)) {
      invalidateValues();
      continue;
    }
    entries.set(name, {
      name,
      node: property,
      value: property.kind === "init" ? property.value : undefined,
    });
  }
  return { entries, complete };
}

export function objectProperties(sourceCode, node) {
  const object = resolveObject(sourceCode, node, new Set());
  return object ? [...object.entries.values()] : [];
}
