import { MENUS, menuNumberRanges } from './menus.mjs';

export const devices = ['desktop', 'mobile'];
export const layoutFormat = 'pure-white-layout';
export const layoutStarts = [
    {
        label: '宽屏留白',
        desktop: { top: { width: 94 }, chat: { width: 86, maxWidth: 960, paddingX: 16 },
            input: { width: 86, maxWidth: 960 }, 'menus.wand': { columns: 2 } },
    },
    {
        label: '手机易点',
        mobile: { chat: { width: 100, paddingX: 6 }, input: { width: 100, paddingY: 6 },
            sendButton: { hitSize: 44 }, wandButton: { hitSize: 42 }, moreButton: { hitSize: 42 },
            'menus.wand': { columns: 1 }, 'menus.chat': { columns: 1 } },
    },
    {
        label: '双端紧凑',
        desktop: { top: { paddingY: 3 }, chat: { paddingX: 8, paddingY: 5 },
            characterBubble: { padding: 8, gap: 5 }, userBubble: { padding: 8, gap: 5 } },
        mobile: { top: { paddingY: 2 }, chat: { width: 100, paddingX: 4 },
            characterBubble: { padding: 6, gap: 4 }, userBubble: { padding: 6, gap: 4 } },
    },
];

const own = (value, key) => value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key)
    ? value[key] : undefined;

export function layoutFields(sections) {
    const fields = [];
    for (const [area, { label, fields: descriptors }] of Object.entries(sections)) {
        for (const [key, field] of Object.entries(descriptors)) {
            if (field.type === 'number' && !['opacity', 'mask', 'imageOpacity', 'imageX', 'imageY', 'imageScale', 'offsetX', 'offsetY'].includes(key) && area !== 'mobileComposer') {
                fields.push({ area, key, ...field, label: label + ' · ' + field.label });
            }
        }
    }
    for (const [id, { label }] of Object.entries(MENUS)) {
        for (const [key, title, unit] of [
            ['width', '宽度', 'px'], ['height', '最大高度', 'px'], ['columns', '列数', '列'],
            ['gap', '行距', 'px'], ['radius', '圆角', 'px'],
        ]) {
            const [min, max] = menuNumberRanges[key];
            fields.push({ area: 'menus.' + id, key, label: label + ' · ' + title, unit, min, max, menu: id });
        }
    }
    return fields;
}

export const lockId = (device, { area, key }) => [device, area, key].join('/');
export const layoutValue = (template, device, { area, key, menu }) =>
    menu ? template.menus?.[menu]?.[device]?.panel?.[key] : template[device]?.[area]?.[key];

export function cleanLayoutLocks(value, sections) {
    const valid = new Set(devices.flatMap(device => layoutFields(sections).map(field => lockId(device, field))));
    return Array.isArray(value) ? [...new Set(value.filter(key => valid.has(key)))].sort() : [];
}

function blocked(template, device, field) {
    const locks = template.layoutLocks ?? [];
    return locks.includes(lockId(device, field)) ||
        (device === 'desktop' && locks.includes(lockId('mobile', field)) &&
            layoutValue(template, 'mobile', field) === undefined);
}

export function layoutPrompt(template, sections, goal) {
    const example = { format: layoutFormat, version: 1, desktop: { top: { width: 92 } }, mobile: {
        top: { width: 100 }, 'menus.wand': { columns: 1 },
    } };
    const rows = layoutFields(sections).map(field => {
        const values = devices.map(device => blocked(template, device, field) ? '锁定' :
            (layoutValue(template, device, field) ?? (device === 'mobile' ? '继承' : '默认')));
        return [field.area, field.key, field.label, field.unit, field.min, field.max, ...values].join(' | ');
    });
    return [
        '为 SillyTavern「纯白」出一份排版。按需求分别考虑桌面和手机，手机确保输入、发送与菜单触达。',
        '只返回 JSON。结构示例（数值仅示意）：' + JSON.stringify(example),
        '只输出需要调整的整数尺寸。省略锁定项。不要输出素材、CSS、颜色或菜单项目。',
        '需求：' + (goal.trim() || '桌面留白舒适，手机紧凑且清晰。'),
        '区域 | 字段 | 含义 | 单位 | 最小 | 最大 | 当前桌面 | 当前手机',
        ...rows,
    ].join('\n');
}

export function readLayoutProposal(text, sections) {
    if (text.length > 64 * 1024) throw new Error('排版 JSON 超过 64 KB。');
    let raw;
    try {
        const source = text.trim();
        raw = JSON.parse(source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? source);
    } catch {
        throw new Error('无法读取 JSON，请粘贴 AI 返回的完整排版。');
    }
    if (raw?.format !== layoutFormat || raw?.version !== 1) throw new Error('请使用纯白生成提示词中指定的排版格式。');
    return devices.flatMap(device => layoutFields(sections).flatMap(field => {
        const value = own(own(own(raw, device), field.area), field.key);
        return Number.isInteger(value) && value >= field.min && value <= field.max ? [{ ...field, device, value }] : [];
    }));
}

export function layoutChanges(template, proposal) {
    return proposal.filter(field => !blocked(template, field.device, field) &&
        layoutValue(template, field.device, field) !== field.value);
}

export function applyLayout(template, proposal) {
    const next = structuredClone(template);
    for (const field of layoutChanges(template, proposal)) {
        const { area, key, menu, device, value } = field;
        let fields;
        if (menu) {
            const menus = next.menus ??= {};
            const config = menus[menu] ??= {};
            fields = (config[device] ??= {}).panel ??= {};
        } else {
            fields = next[device][area] ??= {};
        }
        fields[key] = value;
    }
    return next;
}


