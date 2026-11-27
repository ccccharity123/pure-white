export const MENUS = {
    wand: { label: '魔杖菜单', trigger: '#extensionsMenuButton', panel: '#extensionsMenu', content: '#extensionsMenu' },
    chat: { label: '聊天操作菜单', trigger: '#options_button', panel: '#options', content: '#options > .options-content' },
};

const fields = {
    width: [180, 720], height: [120, 900], columns: [1, 3], gap: [0, 32], opacity: [10, 100],
    radius: [0, 48], textSize: [10, 26], order: [1, 999],
};
const validKey = /^[a-z][a-z0-9:_-]{0,139}$/i;
const idKey = /^id:([a-z][a-z0-9_-]*)(?::(\d+))?$/i;
const color = /^#[0-9a-f]{6}$/i;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const defined = value => plain(value) ? value : {};

export function cleanMenus(value, url) {
    const output = {};
    function appearance(raw, accepted) {
        const result = {};
        for (const key of accepted) {
            const item = raw?.[key];
            if (fields[key] && Number.isFinite(item)) {
                const [min, max] = fields[key];
                result[key] = Math.min(max, Math.max(min, Math.round(item)));
            } else if (['fill', 'color'].includes(key) && typeof item === 'string' && color.test(item)) {
                result[key] = item.toLowerCase();
            } else if (['background', 'icon'].includes(key) && typeof item === 'string') {
                const safe = url(item);
                if (safe !== undefined) result[key] = safe;
            } else if (key === 'position' && ['native', 'top', 'bottom', 'center'].includes(item)) {
                result[key] = item;
            } else if (key === 'label' && typeof item === 'string') {
                result[key] = item.trim().slice(0, 64);
            } else if (key === 'group' && typeof item === 'string' && (item === '' || item === 'more' || validKey.test(item))) {
                result[key] = item;
            } else if (key === 'pinned' && typeof item === 'boolean') {
                result[key] = item;
            }
        }
        return result;
    }

    for (const key of ['global', ...Object.keys(MENUS)]) {
        const data = value?.[key];
        if (!plain(data)) continue;
        const menu = {};
        const groups = {};
        for (const [id, label] of Object.entries(defined(data.groups)).slice(0, 20)) {
            if (id !== 'more' && validKey.test(id) && !Object.hasOwn(Object.prototype, id) && typeof label === 'string' && label.trim()) groups[id] = label.trim().slice(0, 40);
        }
        if (key !== 'global' && Object.keys(groups).length) menu.groups = groups;
        for (const device of ['desktop', 'mobile']) {
            if (!plain(data[device])) continue;
            const input = data[device];
            const layer = {};
            const panel = appearance(input.panel, ['width', 'height', 'columns', 'gap', 'background', 'fill', 'opacity', 'radius', 'position']);
            const entry = appearance(input.entry, ['color', 'fill', 'radius', 'textSize', 'icon']);
            const itemStyle = appearance(input.itemStyle, ['color', 'fill', 'radius', 'textSize', 'icon']);
            if (Object.keys(panel).length) layer.panel = panel;
            if (Object.keys(entry).length) layer.entry = entry;
            if (Object.keys(itemStyle).length) layer.itemStyle = itemStyle;
            const items = {};
            for (const [id, values] of Object.entries(defined(input.items)).slice(0, 300)) {
                if (!validKey.test(id) || Object.hasOwn(Object.prototype, id) || !plain(values)) continue;
                const item = appearance(values, ['order', 'group', 'pinned', 'label', 'icon', 'color', 'fill', 'radius', 'textSize']);
                if (item.group && item.group !== 'more' && !Object.hasOwn(groups, item.group)) delete item.group;
                if (Object.keys(item).length) items[id] = item;
            }
            if (key !== 'global' && Object.keys(items).length) layer.items = items;
            if (Object.keys(layer).length) menu[device] = layer;
        }
        if (Object.keys(menu).length) output[key] = menu;
    }
    return output;
}

export function menuView(menus, id, mobile) {
    const global = menus?.global;
    const own = menus?.[id];
    const layers = [global?.desktop, mobile ? global?.mobile : undefined, own?.desktop, mobile ? own?.mobile : undefined];
    const view = { groups: own?.groups ?? {}, items: {} };
    for (const name of ['panel', 'entry', 'itemStyle']) {
        view[name] = Object.assign({}, ...layers.map(layer => layer?.[name]));
    }
    for (const layer of layers) {
        for (const [key, value] of Object.entries(layer?.items ?? {})) {
            view.items[key] = { ...view.items[key], ...value };
        }
    }
    return view;
}

const hasFlow = values => values.order !== undefined || values.pinned || values.group;
export function menuNeedsGrid(view) {
    return view.panel.columns !== undefined || view.panel.gap !== undefined || Object.values(view.items).some(hasFlow);
}

export function runtimeMenuFeatures(menus) {
    const result = [];
    for (const [id, menu] of Object.entries(MENUS)) {
        const types = new Set();
        const keys = new Set();
        for (const mobile of [false, true]) {
            const view = menuView(menus, id, mobile);
            if (view.panel.position && view.panel.position !== 'native') types.add('打开位置');
            for (const [key, item] of Object.entries(view.items)) {
                if (item.label) { types.add('改名'); keys.add(key); }
                if (item.pinned || item.order !== undefined) { types.add('排序与置顶'); keys.add(key); }
                if (item.group) { types.add('分组与更多'); keys.add(key); }
                if ((!idKey.test(key) || /:\d+$/.test(key) || key === 'id:option_close_chat') && ['icon', 'color', 'fill', 'radius', 'textSize'].some(field => item[field] !== undefined)) {
                    types.add('扩展标识项目外观'); keys.add(key);
                }
            }
        }
        if (types.size) result.push(menu.label + '：' + [...types].join('、') + (keys.size ? '（' + [...keys].join('、') + '）' : ''));
    }
    return result;
}

function colorAlpha(hex, opacity) {
    if (!hex) return 'color-mix(in srgb, var(--SmartThemeBlurTintColor) ' + (opacity ?? 100) + '%, transparent)';
    const channels = hex.slice(1).match(/../g).map(part => parseInt(part, 16));
    return 'rgba(' + channels.join(', ') + ', ' + (opacity ?? 100) / 100 + ')';
}

export function compileMenuCss(menus, cssString, breakpoint, runtime = false) {
    if (!menus || !Object.keys(menus).length) return '';
    const rule = (selector, values) => {
        const entries = Object.entries(values).filter(([, value]) => value !== undefined);
        return entries.length ? selector + ' {\n' + entries.map(([key, value]) => '  ' + key + ': ' + value + ' !important;').join('\n') + '\n}\n' : '';
    };
    const px = value => value === undefined ? undefined : value + 'px';
    const url = value => value ? 'url(' + cssString(value) + ')' : 'none';
    const iconDeclarations = asset => ({
        content: '""', display: 'inline-block', width: '1em', height: '1em',
        'background-image': url(asset), 'background-size': 'contain', 'background-repeat': 'no-repeat', 'background-position': 'center',
    });
    const styleItem = (selector, data, iconSelector = selector + ' > :is(i.fa-solid,.extensionsMenuExtensionButton)::before') => {
        let css = rule(selector, { color: data.color, 'background-color': data.fill, 'border-radius': px(data.radius), 'font-size': px(data.textSize) });
        if (data.icon) css += rule(iconSelector, iconDeclarations(data.icon));
        return css;
    };
    let output = '';
    for (const mobile of [false, true]) {
        let css = '';
        for (const [id, { trigger, panel, content }] of Object.entries(MENUS)) {
            const view = menuView(menus, id, mobile);
            const p = view.panel;
            const nativeItem = id === 'wand'
                ? content + ' > :is(.list-group-item,[data-extension-menu-id]), ' + content + ' > .extension_container > :is(.list-group-item,div,a,button)'
                : content + ' > a';
            const grid = runtime ? menuNeedsGrid(view) : p.columns !== undefined || p.gap !== undefined;
            if (Object.keys(p).length || grid) {
                const limit = 'max(1px, calc(var(--tle-menu-viewport, 100dvh) - 70px))';
                if (p.width !== undefined) css += rule(panel, { width: 'min(' + p.width + 'px, calc(100dvw - 16px))' });
                css += rule(content, {
                    width: p.width === undefined || content === panel ? undefined : '100%',
                    'max-width': 'calc(100dvw - 16px)',
                    'max-height': p.height === undefined ? limit : 'min(' + p.height + 'px, ' + limit + ')',
                    'box-sizing': 'border-box', 'overflow-y': 'auto', 'overscroll-behavior': 'contain',
                    'background-image': p.background === undefined ? undefined : url(p.background),
                    'background-size': p.background ? 'cover' : undefined,
                    'background-position': p.background ? 'center' : undefined,
                    'background-color': p.fill || p.opacity !== undefined ? colorAlpha(p.fill, p.opacity) : undefined,
                    'border-radius': px(p.radius),
                });
                if (grid) {
                    const open = id === 'wand' ? content + ':not([style*="display: none"]):not([hidden],.displayNone)' : content;
                    css += rule(open, {
                        display: 'grid', 'grid-template-columns': 'repeat(' + (p.columns ?? 1) + ', minmax(0, 1fr))', gap: px(p.gap ?? 0),
                        'align-content': 'start',
                    });
                    css += rule(content + ' > hr', { 'grid-column': '1 / -1' });
                    if (id === 'wand') css += rule(content + ' > .extension_container:not([hidden],.displayNone,[style*="display: none"])', { display: 'contents' });
                    css += rule(nativeItem, { 'min-width': '0', 'overflow-wrap': 'anywhere' });
                }
            }
            css += styleItem(trigger, view.entry, trigger + '::before');
            css += styleItem(':is(' + nativeItem + ')', runtime ? { ...view.itemStyle, icon: undefined } : view.itemStyle);
            for (const [key, item] of Object.entries(view.items)) {
                const match = idKey.exec(key);
                if (runtime) {
                    css += styleItem(content + ' [data-tle-native-item=' + cssString(key) + ']', { ...item, icon: undefined });
                } else if (match && !match[2] && !view.items[key + ':2'] && match[1] !== 'option_close_chat') {
                    css += styleItem(content + ' #' + match[1], item);
                }
            }
        }
        if (css) output += (mobile ? '@media screen and (max-width: ' + breakpoint + 'px)' : '@media not all and (max-width: ' + breakpoint + 'px)') + ' {\n' + css + '}\n';
    }
    return output;
}
