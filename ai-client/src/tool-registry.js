import Ajv2020 from 'ajv/dist/2020.js';

function copySchema(schema) {
  const copy = structuredClone(schema);

  if (copy.type === 'object' || copy.properties) {
    copy.type ??= 'object';
    copy.properties ??= {};
    copy.required ??= [];
    copy.additionalProperties = false;
    for (const propertySchema of Object.values(copy.properties)) {
      applyObjectRestrictions(propertySchema);
    }
  }

  return copy;
}

function applyObjectRestrictions(schema) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type === 'object' || schema.properties) {
    schema.type ??= 'object';
    schema.properties ??= {};
    schema.required ??= [];
    schema.additionalProperties = false;
    for (const propertySchema of Object.values(schema.properties)) {
      applyObjectRestrictions(propertySchema);
    }
  }

  if (schema.items) applyObjectRestrictions(schema.items);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    for (const branch of schema[key] ?? []) applyObjectRestrictions(branch);
  }
}

function isStrictCompatible(schema) {
  if (schema.type === 'object' || schema.properties) {
    const propertyNames = Object.keys(schema.properties ?? {});
    const required = new Set(schema.required ?? []);
    if (propertyNames.some((name) => !required.has(name))) return false;
    if (propertyNames.some((name) => !isStrictCompatible(schema.properties[name]))) return false;
  }

  if (schema.items && !isStrictCompatible(schema.items)) return false;
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if ((schema[key] ?? []).some((branch) => !isStrictCompatible(branch))) return false;
  }

  return true;
}

export function createReadOnlyToolRegistry(discoveredTools, { ajv = new Ajv2020({ allErrors: true, strict: false }) } = {}) {
  if (!Array.isArray(discoveredTools)) {
    throw new Error('The MCP server returned an invalid tools list.');
  }

  const registry = new Map();
  const openAiTools = [];

  for (const tool of discoveredTools) {
    if (tool?.annotations?.readOnlyHint !== true) continue;
    if (typeof tool.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)) {
      throw new Error('The MCP server advertised a tool with an invalid name.');
    }
    if (registry.has(tool.name)) {
      throw new Error(`The MCP server advertised the tool '${tool.name}' more than once.`);
    }

    const rawSchema = tool.inputSchema ?? { type: 'object', properties: {}, required: [] };
    if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) {
      throw new Error(`The MCP server advertised an invalid input schema for '${tool.name}'.`);
    }

    const validationSchema = copySchema(rawSchema);
    const parameters = structuredClone(validationSchema);
    delete parameters.$schema;
    delete parameters.$id;
    let validate;
    try {
      validate = ajv.compile(validationSchema);
    } catch {
      throw new Error(`The MCP input schema for '${tool.name}' could not be validated.`);
    }

    const definition = {
      type: 'function',
      name: tool.name,
      description: tool.description || `Read data using the ${tool.name} MCP tool.`,
      parameters,
      strict: isStrictCompatible(parameters),
    };

    registry.set(tool.name, { tool, parameters, validate });
    openAiTools.push(definition);
  }

  if (registry.size === 0) {
    throw new Error('The MCP server did not advertise any read-only tools.');
  }

  return { registry, openAiTools };
}

function textContent(result) {
  return (result.content ?? []).map((item) => {
    if (item.type === 'text') return item.text;
    return `[${item.type} content omitted]`;
  });
}

export async function executeDiscoveredTool({ name, argumentsText, registry, mcpClient }) {
  const entry = registry.get(name);
  if (!entry) {
    return { isError: true, error: `Unknown or non-read-only MCP tool '${name}'.` };
  }

  let args;
  try {
    args = JSON.parse(argumentsText);
  } catch {
    return { isError: true, error: `Arguments for '${name}' were not valid JSON.` };
  }

  if (!entry.validate(args)) {
    const details = ajvErrors(entry.validate.errors);
    return { isError: true, error: `Invalid arguments for '${name}': ${details}` };
  }

  try {
    const result = await mcpClient.callTool({ name, arguments: args });
    const normalized = {};
    if (result.isError) normalized.isError = true;
    if (result.structuredContent !== undefined) {
      normalized.structuredContent = result.structuredContent;
    }
    const content = textContent(result);
    if (content.length > 0) normalized.content = content;
    return normalized;
  } catch {
    return { isError: true, error: `MCP tool '${name}' failed. Check the MCP server and Fastify backend.` };
  }
}

function ajvErrors(errors) {
  return errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
    || 'the arguments do not match the tool schema.';
}
