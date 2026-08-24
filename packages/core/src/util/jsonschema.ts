import { z } from "zod";

/**
 * Minimal zod → JSON Schema converter covering the subset Mosaic's tools use:
 * object, string, number, integer, boolean, array, enum, literal, union (anyOf),
 * optional, nullable, default, describe. Avoids a runtime dependency on
 * zod-to-json-schema.
 */

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema, new Set());
}

function convert(schema: z.ZodTypeAny, seen: Set<z.ZodTypeAny>): Record<string, unknown> {
  if (seen.has(schema)) return {}; // cycle guard
  seen.add(schema);

  // Unwrap wrappers first.
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return convert(schema.unwrap() as z.ZodTypeAny, seen);
  }
  if (schema instanceof z.ZodDefault) {
    const inner = convert(schema._def.innerType as z.ZodTypeAny, seen);
    inner.default = schema._def.defaultValue();
    return withDescription(schema, inner);
  }
  if (schema instanceof z.ZodEffects) {
    return convert(schema._def.schema as z.ZodTypeAny, seen);
  }
  if (schema instanceof z.ZodBranded) {
    return convert(schema._def.type as z.ZodTypeAny, seen);
  }
  if (schema instanceof z.ZodPipeline) {
    return convert(schema._def.in as z.ZodTypeAny, seen);
  }

  let out: Record<string, unknown>;

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value, new Set(seen));
      if (!isOptional(value)) required.push(key);
    }
    out = { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
  } else if (schema instanceof z.ZodString) {
    out = { type: "string" };
    for (const check of schema._def.checks ?? []) {
      if (check.kind === "min") out.minLength = check.value;
      if (check.kind === "max") out.maxLength = check.value;
    }
  } else if (schema instanceof z.ZodNumber) {
    out = { type: schema._def.checks?.some((c: { kind: string }) => c.kind === "int") ? "integer" : "number" };
    for (const check of schema._def.checks ?? []) {
      if (check.kind === "min") out.minimum = check.value;
      if (check.kind === "max") out.maximum = check.value;
    }
  } else if (schema instanceof z.ZodBoolean) {
    out = { type: "boolean" };
  } else if (schema instanceof z.ZodArray) {
    out = { type: "array", items: convert(schema.element as z.ZodTypeAny, new Set(seen)) };
  } else if (schema instanceof z.ZodEnum) {
    out = { type: "string", enum: schema._def.values };
  } else if (schema instanceof z.ZodNativeEnum) {
    out = { type: "string", enum: Object.values(schema._def.values) };
  } else if (schema instanceof z.ZodLiteral) {
    out = { const: schema._def.value };
  } else if (schema instanceof z.ZodUnion) {
    out = { anyOf: (schema._def.options as z.ZodTypeAny[]).map((o) => convert(o, new Set(seen))) };
  } else if (schema instanceof z.ZodTuple) {
    out = {
      type: "array",
      prefixItems: (schema._def.items as z.ZodTypeAny[]).map((i) => convert(i, new Set(seen))),
    };
  } else if (schema instanceof z.ZodRecord) {
    out = { type: "object", additionalProperties: convert(schema._def.valueType as z.ZodTypeAny, new Set(seen)) };
  } else {
    out = {}; // ZodAny / ZodUnknown / unsupported → permissive
  }

  return withDescription(schema, out);
}

function withDescription(schema: z.ZodTypeAny, out: Record<string, unknown>): Record<string, unknown> {
  const description = schema._def.description ?? schema.description;
  if (description && !out.description) out.description = description;
  return out;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) return true;
  if (schema instanceof z.ZodNullable) return isOptional(schema.unwrap() as z.ZodTypeAny);
  if (schema instanceof z.ZodEffects) return isOptional(schema._def.schema as z.ZodTypeAny);
  return false;
}
