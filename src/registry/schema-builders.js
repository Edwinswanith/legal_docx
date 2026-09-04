// Small helpers for writing Gemini `responseSchema` objects (a restricted
// OpenAPI/JSON-Schema subset) without repeating `{ type: 'STRING' }` boilerplate
// everywhere. Nothing here is specific to any document type — it is pure
// schema-composition infrastructure, reused by every entry in the registry.

function str(description, opts = {}) {
  return { type: 'STRING', description, ...opts };
}

function num(description, opts = {}) {
  return { type: 'NUMBER', description, ...opts };
}

function bool(description, opts = {}) {
  return { type: 'BOOLEAN', description, ...opts };
}

function nullableStr(description) {
  return str(description, { nullable: true });
}

function arr(items, description, opts = {}) {
  return { type: 'ARRAY', items, description, ...opts };
}

function obj(properties, required = [], description) {
  return {
    type: 'OBJECT',
    properties,
    ...(required.length ? { required } : {}),
    ...(description ? { description } : {}),
  };
}

function money(description) {
  return obj(
    {
      value: nullableStr('Numeric amount as written, digits only where possible (e.g. "9300000").'),
      currency: nullableStr('Currency, usually "INR".'),
      amountInWords: nullableStr('The amount spelled out in words, if stated in the document.'),
    },
    [],
    description,
  );
}

module.exports = { str, num, bool, nullableStr, arr, obj, money };
