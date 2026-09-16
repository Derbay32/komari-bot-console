export function findVariable(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable;
  }
}

export function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
}

export function propertyName(node) {
  if (!node.computed && node.key.type === "Identifier") return node.key.name;
  return staticString(node.key);
}

// Only bindings whose runtime identity is known are followed. In particular,
// a destructured binding is not an alias of its entire initializer.
export function importedBinding(sourceCode, node, seen = new Set()) {
  if (node.type === "JSXMemberExpression") {
    const object = importedBinding(sourceCode, node.object, seen);
    if (object?.name === "*") return { source: object.source, name: node.property.name };
    return;
  }
  if (node.type !== "JSXIdentifier" && node.type !== "Identifier") return;
  const variable = findVariable(sourceCode, node, node.name);
  if (!variable || seen.has(variable)) return;
  seen.add(variable);
  const definition = variable.defs[0];
  if (definition?.type === "ImportBinding") {
    const specifier = definition.node;
    let name;
    if (specifier.type === "ImportSpecifier") {
      name = specifier.imported.name ?? specifier.imported.value;
    } else if (specifier.type === "ImportDefaultSpecifier") {
      name = "default";
    } else if (specifier.type === "ImportNamespaceSpecifier") {
      name = "*";
    }
    return { source: definition.parent.source.value, name };
  }
  if (
    definition?.type === "Variable" &&
    definition.parent.kind === "const" &&
    definition.node.id.type === "Identifier" &&
    definition.node.init?.type === "Identifier"
  ) {
    return importedBinding(sourceCode, definition.node.init, seen);
  }
}
