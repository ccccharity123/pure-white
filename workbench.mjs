import { MENUS, MENU_STYLE_FIELDS, isMenuItemKey } from './menus.mjs';

export const WORKBENCH_ACTIONS = {
    create: ['做一套主题', '新建副本 向导'],
    ai: ['导入 AI 排版', '试套 内置排版 提示词'],
    materials: ['换素材', '图片 照片 取景 拖动图片'],
    batch: ['批量换素材', '同时换图 消息边框 图片'],
    favorites: ['素材收藏', '图片 本地照片'],
    review: ['查看改动', '核对 恢复 撤销'],
    templates: ['我的模板', '导入 导出 保存 分享'],
};

export function cleanQuickAccess(value, sections) {
    if (!Array.isArray(value)) return [];
    const known = id => {
        if (typeof id !== 'string') return false;
        const [kind, target, area, field, ...extra] = id.split('/');
        if (extra.length) return false;
        if (kind === 'action') return area === undefined && Object.hasOwn(WORKBENCH_ACTIONS, target);
        if (kind === 'appearance') {
            return field === undefined && Object.hasOwn(sections, target) && Object.hasOwn(sections[target].fields, area);
        }
        if (kind === 'menu') {
            return (target === 'global' || Object.hasOwn(MENUS, target)) &&
                Object.hasOwn(MENU_STYLE_FIELDS, area) && MENU_STYLE_FIELDS[area].includes(field);
        }
        return kind === 'item' && Object.hasOwn(MENUS, target) && isMenuItemKey(area) && field === undefined;
    };
    return [...new Set(value.filter(known))];
}

const normalize = text => text.toLowerCase().replace(/[\s·（）()]/g, '');

export function searchWorkbench(entries, query) {
    const words = query.trim().toLowerCase().split(/\s+/).map(normalize).filter(Boolean);
    if (!words.length) return [];
    const phrase = normalize(query);
    return entries.flatMap(entry => {
        const title = normalize(entry.title);
        const context = normalize(entry.context);
        const aliases = [entry.context, ...entry.context.split('·'), ...(entry.keywords ?? '').split(/\s+/)]
            .map(normalize).filter(Boolean);
        const matches = [title, context, ...aliases, ...aliases.flatMap(alias => [alias + title, title + alias])];
        if (!words.every(word => matches.some(candidate => candidate.includes(word)))) return [];
        const rank = title === phrase ? 0 : title.includes(phrase) ? 1 : context.includes(phrase) ? 2 : 3;
        return [{ entry, rank }];
    }).sort((a, b) => a.rank - b.rank || Number(Boolean(a.entry.legacy)) - Number(Boolean(b.entry.legacy)))
        .map(({ entry }) => entry);
}
