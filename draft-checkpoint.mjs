import { equalSettings, parseTemplate } from './model.mjs';

export const templateLimit = 100;
export const isTemplateId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

export function readTemplates(input) {
    const templates = {};
    for (const [id, layout] of Object.entries(input ?? {}).slice(0, templateLimit)) {
        if (!isTemplateId(id)) continue;
        try {
            templates[id] = parseTemplate(layout);
        } catch {
            // Keep the valid templates when an entry cannot be read.
        }
    }
    return templates;
}

export function checkpointSettings(saved, draft) {
    return {
        active: draft.active,
        layouts: Object.fromEntries(Object.entries(draft.templates).filter(([id, layout]) =>
            id === draft.active || !equalSettings(saved.templates[id], layout))),
        removed: Object.keys(saved.templates).filter(id => !Object.hasOwn(draft.templates, id)),
        auto: draft.auto,
        manual: draft.manual,
        materialFavorites: draft.materialFavorites,
        quickAccess: draft.quickAccess,
    };
}

export function restoreCheckpointSettings(saved, checkpoint) {
    const layouts = readTemplates(checkpoint.layouts);
    if (!Object.hasOwn(layouts, checkpoint.active)) throw new Error('暂存草稿缺少当前模板。');
    const templates = { ...saved.templates, ...layouts };
    for (const id of Array.isArray(checkpoint.removed) ? checkpoint.removed : []) {
        if (isTemplateId(id) && !Object.hasOwn(layouts, id)) delete templates[id];
    }
    if (Object.keys(templates).length > templateLimit) throw new Error('模板数量已达到上限。');
    return { active: checkpoint.active, templates };
}


