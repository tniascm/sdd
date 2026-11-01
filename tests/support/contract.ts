/**
 * Contract checker: validates an HTTP response against specs/001-room-booking/contracts/openapi.yaml.
 * - the status code must be documented for the operation
 * - the JSON body must match the documented schema (schemas reject unknown properties,
 *   so leaked fields such as password hashes fail here)
 * Written by the Verifier; independent of the implementation.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';

const SPEC_PATH = fileURLToPath(
  new URL('../../specs/001-room-booking/contracts/openapi.yaml', import.meta.url),
);
export const openapi = parse(readFileSync(SPEC_PATH, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
// Formats used by the contract, defined here to avoid an extra dependency.
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
ajv.addSchema(openapi, 'openapi');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];

interface Operation {
  method: Method;
  template: string;
  regex: RegExp;
  literalSegments: number;
}

const operations: Operation[] = [];
for (const [template, item] of Object.entries<Record<string, unknown>>(openapi.paths)) {
  for (const method of METHODS) {
    if (!item[method]) continue;
    const pattern = template.replace(/\{[^}]+\}/g, '[^/]+');
    operations.push({
      method,
      template,
      regex: new RegExp(`^${pattern}$`),
      literalSegments: template.split('/').filter((s) => s && !s.startsWith('{')).length,
    });
  }
}

export const documentedOperations = operations.map((o) => `${o.method.toUpperCase()} ${o.template}`);

export function findOperation(method: string, path: string): Operation | undefined {
  const m = method.toLowerCase();
  const p = path.split('?')[0].replace(/^\/api\/v1/, '');
  return operations
    .filter((o) => o.method === m && o.regex.test(p))
    .sort((a, b) => b.literalSegments - a.literalSegments)[0];
}

const ptr = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const cache = new Map<string, ReturnType<typeof ajv.compile>>();

function validatorFor(op: Operation, status: number) {
  const key = `${op.method} ${op.template} ${status}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const responses = openapi.paths[op.template][op.method].responses as Record<string, any>;
  const response = responses[String(status)];
  if (!response) return undefined;
  let base: string;
  if (response.$ref) {
    base = `openapi${response.$ref}`;
    const name = String(response.$ref).split('/').pop()!;
    if (!openapi.components.responses[name].content) return null;
  } else {
    if (!response.content) return null;
    base = `openapi#/paths/${ptr(op.template)}/${op.method}/responses/${status}`;
  }
  const v = ajv.compile({ $ref: `${base}/content/${ptr('application/json')}/schema` });
  cache.set(key, v);
  return v;
}

/** Operations exercised in this process (used by the contract-coverage test). */
export const exercised = new Set<string>();

export function checkContract(method: string, path: string, status: number, body: unknown): void {
  const op = findOperation(method, path);
  if (!op) {
    // Undocumented API paths must answer with the generic 404 error shape.
    if (status === 404) return assertErrorShape(body, `${method} ${path}`);
    throw new Error(`Contract: ${method} ${path} is not a documented operation (status ${status})`);
  }
  exercised.add(`${op.method.toUpperCase()} ${op.template}`);
  const v = validatorFor(op, status);
  if (v === undefined) {
    throw new Error(
      `Contract: status ${status} is not documented for ${op.method.toUpperCase()} ${op.template}; body=${JSON.stringify(body)}`,
    );
  }
  if (v === null) return; // documented without a body (e.g. 204)
  if (!v(body)) {
    throw new Error(
      `Contract: response body of ${op.method.toUpperCase()} ${op.template} (${status}) violates schema: ` +
        `${ajv.errorsText(v.errors)}; body=${JSON.stringify(body).slice(0, 500)}`,
    );
  }
}

const errorValidator = ajv.compile({ $ref: 'openapi#/components/schemas/Error' });
function assertErrorShape(body: unknown, what: string) {
  if (!errorValidator(body)) {
    throw new Error(`Contract: ${what} error body violates Error schema: ${ajv.errorsText(errorValidator.errors)}`);
  }
}
