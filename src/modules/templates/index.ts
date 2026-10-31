/** templates: validated template data -> note documents with fresh block ids (plan F12). */
import { BUILTIN_TEMPLATES } from './builtins';
import { validateTemplate, type Template } from './schema';

export { templateSchema, validateTemplate, blockSpecSchema, TEMPLATE_SCHEMA_VERSION, type Template, type BlockSpec, type TemplateReport } from './schema';
export { instantiateTemplate, applyTemplateTo, templateBlocks, formatTemplateDate, type InstantiateOptions } from './instantiate';
export { BUILTIN_TEMPLATES } from './builtins';

export interface TemplateRegistry {
  list(): Template[];
  get(id: string): Template | undefined;
  /** Bundled templates that failed validation (a build bug; reported by tests). */
  rejected: string[];
}

export function createTemplateRegistry(raw: readonly unknown[] = BUILTIN_TEMPLATES): TemplateRegistry {
  const map = new Map<string, Template>();
  const rejected: string[] = [];
  raw.forEach((r, i) => {
    const rep = validateTemplate(r);
    if (rep.ok && rep.template && !map.has(rep.template.id)) map.set(rep.template.id, rep.template);
    else rejected.push(`template #${i}`);
  });
  return { list: () => [...map.values()], get: (id) => map.get(id), rejected };
}
