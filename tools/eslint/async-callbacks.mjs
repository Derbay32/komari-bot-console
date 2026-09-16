import tseslint from "typescript-eslint";

import { importedBinding } from "./bindings.mjs";

const baseRule = tseslint.plugin.rules["no-misused-promises"];

function isAllowedCallback(context, descriptor, allowedCallbacks) {
  if (descriptor.messageId !== "voidReturnAttribute") return false;
  const attribute = descriptor.node.parent;
  if (attribute?.type !== "JSXAttribute") return false;
  const component = importedBinding(context.sourceCode, attribute.parent.name);
  return component && allowedCallbacks.some((allowed) =>
    allowed.source === component.source &&
    allowed.name === component.name &&
    allowed.attribute === attribute.name.name,
  );
}

// Delegate every check to the upstream rule. Filter only reviewed JSX callback
// contracts whose runtime consumes a Promise despite a void-returning .d.ts.
const asyncCallbacks = {
  ...baseRule,
  meta: {
    ...baseRule.meta,
    schema: [{
      ...baseRule.meta.schema[0],
      properties: {
        ...baseRule.meta.schema[0].properties,
        allowedCallbacks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["source", "name", "attribute"],
            properties: {
              source: { type: "string" },
              name: { type: "string" },
              attribute: { type: "string" },
            },
          },
        },
      },
    }],
  },
  create(context) {
    const { allowedCallbacks = [], ...options } = context.options[0] ?? {};
    const delegatedContext = Object.create(context, {
      options: { value: [options] },
      report: {
        value(descriptor) {
          if (!isAllowedCallback(context, descriptor, allowedCallbacks)) {
            context.report(descriptor);
          }
        },
      },
    });
    return baseRule.create(delegatedContext);
  },
};

export default asyncCallbacks;
