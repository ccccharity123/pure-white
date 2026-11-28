import { cleanLayoutLocks } from './ai-layout.mjs';
import { IMAGE_SIZE_OPTIONS, imagePosition, imageSize, normalizeInlineImage } from './image-assets.mjs';
import { MENUS, cleanMenus, compileMenuCss, menuView, runtimeMenuFeatures } from './menus.mjs';

export const FORMAT = 'sillytavern-layout-editor';
export const VERSION = 1;
export const BREAKPOINT = 1000;

const number = (label, min, max, unit, suggested) => ({ label, min, max, unit, suggested, type: 'number' });
const color = label => ({ label, type: 'color' });
const choices = (label, options) => ({ label, type: 'select', options });
const box = (padding, margin) => ({
    width: number('宽度', 25, 100, '%', 90),
    maxWidth: number('最大宽度', 240, 2400, 'px', 960),
    paddingX: number('左右内距', 0, padding, 'px', 8),
    paddingY: number('上下内距', 0, padding, 'px', 8),
    marginX: number('左右外距', 0, margin, 'px', 8),
    marginY: number('上下外距', 0, margin, 'px', 4),
    radius: number('圆角', 0, 64, 'px', 12),
    color: color('底色'),
    opacity: number('底色不透明度', 0, 100, '%', 90),
});
const image = {
    url: { label: '图片 URL', type: 'url' },
    size: choices('图片缩放', IMAGE_SIZE_OPTIONS),
    position: choices('图片位置', { center: '居中', top: '上方', bottom: '下方', left: '左侧', right: '右侧' }),
    imageX: number('图片水平位置', -1, 100, '%', 50),
    imageY: number('图片垂直位置', -1, 100, '%', 50),
    imageScale: number('图片自定缩放', 0, 300, '%', 100),
    mask: number('黑色遮罩不透明度', 0, 100, '%', 25),
    imageOpacity: number('图片不透明度', 0, 100, '%', 80),
};

const text = (label, max = 100, hint = '') => ({ label, max, hint, type: 'text' });
const fonts = { system: '系统无衬线', serif: '衬线', monospace: '等宽' };
const typography = {
    color: color('文字颜色'), fontSize: number('字号', 9, 32, 'px', 15),
    font: choices('字体', fonts), line: number('行高', 100, 250, '%', 150),
};
const icons = { native: '原生图标', plane: '纸飞机', dice: '骰子', moon: '月亮', pen: '笔', copy: '复制', stop: '停止', wand: '魔杖', down: '向下', star: '星星' };
const iconCode = { plane: 'f1d8', dice: 'f522', moon: 'f186', pen: 'f304', copy: 'f0c5', stop: 'f04d', wand: 'e2ca', down: 'f063', star: 'f005' };
const topButtons = {
    aiButton: ['AI 回复配置', '#ai-config-button'],
    connectionButton: ['API 连接', '#sys-settings-button'],
    formattingButton: ['高级格式', '#advanced-formatting-button'],
    loreButton: ['世界书按钮', '#WI-SP-button'],
    settingsButton: ['用户设置按钮', '#user-settings-button'],
    backgroundsButton: ['背景按钮', '#backgrounds-button'],
    extensionsButton: ['扩展面板按钮', '#extensions-settings-button'],
    personaButton: ['用户身份按钮', '#persona-management-button'],
    charactersButton: ['角色列表按钮', '#rightNavHolder'],
};
const buttons = {
    ...Object.fromEntries(Object.entries(topButtons).map(([key, [label, selector]]) => [key, [label, selector + ' .drawer-icon']])),
    topButton: ['统一顶栏按钮', '#top-settings-holder .drawer-icon'],
    sendButton: ['发送', '#send_but'],
    stopButton: ['停止生成', '#mes_stop'],
    regenerateButton: ['重抽', '#option_regenerate'],
    swipeButton: ['下一次回答', '#chat .swipe_right'],
    editButton: ['编辑消息', '#chat .mes_edit'],
    copyButton: ['复制消息', '#chat .mes_copy'],
    wandButton: ['魔杖', '#extensionsMenuButton'],
    moreButton: ['输入栏菜单', '#options_button'],
    bottomButton: ['返回底部（扩展入口）', '#tle-bottom'],
};
export const BUTTON_TARGETS = buttons;
const buttonFields = {
    color: color('图标颜色'), fill: color('按钮底色'), hover: color('悬停底色'), pressed: color('按下底色'), disabled: color('禁用图标颜色'),
    fontSize: number('图标尺寸', 10, 40, 'px', 20), hitSize: number('点击区域（最小）', 20, 44, 'px', 32),
    radius: number('圆角', 0, 40, 'px', 8), gap: number('左右间距', 0, 8, 'px', 2),
    icon: choices('内置图标', icons), url: { label: '图标图片 URL', type: 'url' },
};
const messageFields = {
    fill: color('气泡底色'), opacity: number('底色不透明度', 0, 100, '%', 90), border: color('边框颜色'),
    borderWidth: number('边框宽度', 0, 6, 'px', 1), radius: number('圆角', 0, 48, 'px', 14),
    padding: number('气泡留白', 0, 28, 'px', 12), gap: number('消息间距', 0, 32, 'px', 8),
    align: choices('气泡位置', { left: '靠左', center: '居中', right: '靠右', stretch: '铺满' }),
    ...typography,
};
const avatarFields = {
    sizePx: number('头像尺寸', 20, 100, 'px', 44),
    shape: choices('形状', { circle: '圆形', round: '圆角方形', square: '方形' }),
    border: color('边框颜色'), borderWidth: number('边框宽度', 0, 8, 'px', 2),
};
const user = '#chat .mes[is_user="true"]';
const character = '#chat .mes[is_user="false"]:not([is_system="true"])';
const panelFields = {
    width: number('宽度', 260, 1400, 'px', 520), fill: color('底色'),
    opacity: number('底色不透明度', 0, 100, '%', 92), blur: number('背景模糊', 0, 32, 'px', 12),
    radius: number('圆角', 0, 40, 'px', 12), ...image,
};
const region = (label, group, selector, kind, fields) => ({ label, group, selector, kind, fields });
const artFields = {
    ...image, text: text('文字', 140), color: color('文字颜色'),
    fontSize: number('字号', 10, 36, 'px', 16), sizePx: number('图片尺寸', 16, 380, 'px', 80),
};
export const MESSAGE_INFO = {
    time: '.timestamp', number: '.mesIDDisplay', model: ':is(.timestamp-icon, .tle-model-name)', tokens: '.tokenCounterDisplay',
};
export const COMPOSER_BUTTONS = {
    options: ['聊天菜单', 'options_button'], wand: ['魔杖', 'extensionsMenuButton'],
    send: ['发送', 'send_but'], stop: ['停止生成', 'mes_stop'], next: ['继续生成', 'mes_continue'],
};
const visibility = { show: '显示已有信息', hide: '隐藏', details: '点开看' };
const composerFields = {};
for (const [key, [label]] of Object.entries(COMPOSER_BUTTONS)) {
    composerFields[key] = choices(label + '位置', { native: '酒馆原位', left: '输入框左侧', right: '输入框右侧' });
    composerFields[key + 'Order'] = number(label + '顺序', 1, 9, '位', 5);
}

const frameSides = { top: '上边', right: '右边', bottom: '下边', left: '左边' };
const frameSections = Object.entries(frameSides).map(([side, label]) => [
    'chatFrame' + side,
    region('消息区 · ' + label + '素材', 'messages', '', 'art', {
        url: image.url, sizePx: number('素材厚度', 8, 160, 'px', 38),
        repeat: choices('铺放方式', { repeat: '沿边平铺', stretch: '拉伸铺满' }),
    }),
]);

const extraSections = {
    buttonGroup: region('统一按钮风格', 'buttons', '', 'button', buttonFields),
    topButton: region('统一顶栏按钮', 'buttons', '', 'button', buttonFields),
    ...Object.fromEntries(Object.entries(buttons).filter(([key]) => key !== 'topButton').map(([key, [label, selector]]) => [
        key, region(label, 'buttons', selector, 'button', buttonFields),
    ])),
    userBubble: region('我的消息', 'messages', user + ' .mes_block', 'message', messageFields),
    characterBubble: region('角色消息', 'messages', character + ' .mes_block', 'message', messageFields),
    userAvatar: region('我的头像', 'messages', user + ' .avatar img', 'avatar', avatarFields),
    characterAvatar: region('角色头像', 'messages', character + ' .avatar img', 'avatar', avatarFields),
    dialogue: region('对白（引号内容）', 'messages', '#chat .mes_text q', 'typography', typography),
    narration: region('旁白（斜体内容）', 'messages', '#chat .mes_text :is(em, i)', 'typography', typography),
    quote: region('引用块', 'messages', '#chat .mes_text blockquote', 'typography', typography),
    timestamp: region('时间戳', 'messages', '#chat .mes .timestamp', 'typography', typography),
    charactersPanel: region('角色列表', 'panels', '#right-nav-panel', 'panel', { ...panelFields, dock: choices('移动端位置', { top: '原生位置', bottom: '底部抽屉' }) }),
    worldPanel: region('世界书', 'panels', '#WorldInfo', 'panel', { ...panelFields, dock: choices('移动端位置', { top: '原生位置', bottom: '底部抽屉' }) }),
    settingsPanel: region('用户设置', 'panels', '#user-settings-block', 'panel', { ...panelFields, dock: choices('移动端位置', { top: '原生位置', bottom: '底部抽屉' }) }),
    extensionsPanel: region('扩展面板', 'panels', '#rm_extensions_block', 'panel', { ...panelFields, dock: choices('移动端位置', { top: '原生位置', bottom: '底部抽屉' }) }),
    popupPanel: region('原生弹窗', 'panels', 'dialog.popup', 'panel', panelFields),
    wandMenu: region('魔杖菜单', 'panels', '#extensionsMenu', 'panel', panelFields),
    optionsMenu: region('聊天操作菜单', 'panels', '#options', 'panel', panelFields),
    details: region('细节', 'details', '', 'details', {
        scroll: color('滚动条颜色'), scrollTrack: color('滚动条轨道'), selection: color('文本选中底色'), caret: color('输入光标'),
        separator: color('分隔线'), tooltip: color('提示底色'), loader: color('加载指示颜色'),
        motion: choices('菜单展开动效', { fade: '淡入', none: '即时显示' }),
        loadingMotion: choices('加载动画', { pulse: '轻微脉动', none: '静止' }),
    }),
    cover: region('无聊天封面', 'decorations', '#chat .welcomePanel', 'art', artFields),
    greeting: region('空聊天欢迎语', 'decorations', '#chat:not(:has(.mes, .welcomePanel))', 'art', artFields),
    logo: region('顶栏徽标', 'decorations', '#top-bar', 'art', artFields),
    topPendant: region('顶栏下方 · 挂件', 'decorations', '#top-settings-holder', 'art', {
        url: image.url, sizePx: number('挂件宽度', 24, 260, 'px', 92),
        height: number('挂件高度', 16, 200, 'px', 68),
        offsetX: number('挂件左右偏移', -180, 180, 'px', 0),
        offsetY: number('挂件上下偏移', -100, 160, 'px', 0),
        align: choices('对齐', { left: '靠左', center: '居中', right: '靠右' }),
        imageOpacity: image.imageOpacity,
    }),
    ...Object.fromEntries(frameSections),
    sticker: region('右下角贴纸', 'decorations', '#sheld', 'art', artFields),
    divider: region('消息装饰分隔线', 'decorations', '#chat .mes + .mes .mes_text', 'art', artFields),
    launcher: region('自定义入口', 'runtime', '', 'runtime', {
        entries: choices('显示入口', { none: '关闭', bottom: '返回底部', theme: '换主题', both: '两者都显示', more: '收进更多菜单' }),
        bottomLabel: text('返回底部按钮名称', 18),
        themeLabel: text('换主题按钮名称', 18),
        moreLabel: text('更多菜单名称', 18),
    }),
    messageInfo: region('消息信息显隐', 'messages', '', 'messageInfo', {
        time: choices('时间戳', visibility), number: choices('消息编号', visibility),
        model: choices('模型信息', visibility), tokens: choices('Token 数', visibility),
        reasoning: choices('推理过程', { show: '显示，沿用原生展开状态', hide: '隐藏', expanded: '初始展开', collapsed: '初始折叠' }),
    }),
    mobileComposer: region('手机按钮重排', 'buttons', '', 'runtime', {
        ...composerFields,
        more: choices('消息快捷操作', { on: '收进「更多」', off: '关闭' }),
    }),
    scene: region('场景匹配', 'runtime', '', 'runtime', {
        chat: text('聊天 ID', 160, '留空适用任意聊天'),
        character: text('角色名称', 120, '须与酒馆中的显示名称一致'),
        period: choices('本地时段', { any: '全天', day: '白天 06:00–17:59', night: '夜间 18:00–05:59' }),
    }),
};

export const GROUPS = {
    buttons: '按钮与图标', messages: '消息与头像', panels: '面板与菜单',
    details: '全局细节', decorations: '封面与装饰', runtime: '入口与场景',
};

export const SECTIONS = {
    top: { label: '顶栏', fields: { ...box(32, 32), ...image } },
    chat: { label: '聊天区', fields: { ...box(40, 32), ...image } },
    input: { label: '输入栏', fields: { ...box(24, 24), ...image } },
    page: { label: '页面', fields: { textColor: color('文字颜色'), fontSize: number('字号', 10, 28, 'px', 15), ...image } },
    ...extraSections,
};

const record = value => value && typeof value === 'object' && !Array.isArray(value);
export const cleanName = value => typeof value === 'string' ? value.trim().slice(0, 80) : '';

export function normalizeUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(value)) return undefined;
    const input = value.trim();
    if (!input) return '';
    if (!/^https:\/\//i.test(input)) return undefined;
    try {
        const url = new URL(input);
        if (url.hostname && !url.username && !url.password) return url.href;
    } catch {
        return undefined;
    }
    return undefined;
}

export function normalizeImageSource(value) {
    return normalizeUrl(value) ?? normalizeInlineImage(value);
}

export const MAX_MATERIAL_FAVORITES = 8;

export function cleanMaterialFavorites(value) {
    if (!Array.isArray(value)) return [];
    const favorites = [];
    const seen = new Set();
    for (const entry of value) {
        if (!record(entry)) continue;
        const url = normalizeImageSource(entry.url);
        if (!url || seen.has(url)) continue;
        favorites.push({ url, label: cleanName(entry.label) || '未命名素材' });
        if (favorites.length >= MAX_MATERIAL_FAVORITES) break;
        seen.add(url);
    }
    return favorites;
}

export function cleanField(field, value) {
    switch (field.type) {
        case 'number':
            return typeof value === 'number' && Number.isFinite(value)
                ? Math.round(Math.max(field.min, Math.min(field.max, value)))
                : undefined;
        case 'color':
            return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value.toLowerCase() : undefined;
        case 'select':
            return typeof value === 'string' && Object.hasOwn(field.options, value) ? value : undefined;
        case 'text':
            return typeof value === 'string' ? value.trim().slice(0, field.max) : undefined;
        case 'url':
            return normalizeImageSource(value);
    }
}

function cleanLayout(layout) {
    const output = {};
    for (const [section, { fields }] of Object.entries(SECTIONS)) {
        const values = Object.hasOwn(layout, section) && layout[section];
        if (!record(values)) continue;
        const group = {};
        for (const [key, field] of Object.entries(fields)) {
            if (!Object.hasOwn(values, key)) continue;
            const clean = cleanField(field, values[key]);
            if (clean !== undefined) group[key] = clean;
        }
        if (Object.keys(group).length) output[section] = group;
    }
    return output;
}

export function blankTemplate(name = '默认布局') {
    return { format: FORMAT, version: VERSION, name, desktop: {}, mobile: {} };
}

const panelPresetKeys = ['charactersPanel', 'worldPanel', 'settingsPanel', 'extensionsPanel', 'popupPanel', 'wandMenu', 'optionsMenu'];

function themeDesktop({ box: boxColors, bubble, avatarBorder, avatarShape, panel, details: detailsColors, buttons: buttonColors, font = 'system' }) {
    const desktop = {
        top: { color: boxColors.surface, opacity: 92, radius: 16 },
        chat: { color: boxColors.surface, opacity: 88, radius: 20 },
        input: { color: boxColors.surface, opacity: 94, radius: 18 },
        page: { textColor: boxColors.text, fontSize: 15 },
        userBubble: { ...bubble.user, align: 'right', padding: 12, gap: 10, color: boxColors.text, fontSize: 15, font, line: 150 },
        characterBubble: { ...bubble.character, align: 'left', padding: 12, gap: 10, color: boxColors.text, fontSize: 15, font, line: 150 },
        userAvatar: { shape: avatarShape, border: avatarBorder.user, borderWidth: 2 },
        characterAvatar: { shape: avatarShape, border: avatarBorder.character, borderWidth: 2 },
        buttonGroup: { ...buttonColors, radius: 10 },
        details: { ...detailsColors, motion: 'fade', loadingMotion: 'pulse' },
    };
    for (const key of panelPresetKeys) desktop[key] = { ...panel };
    return desktop;
}

export const THEME_PRESETS = [
    {
        key: 'clean-white', label: '简洁白', description: '白底浅灰，蓝色点缀，干净明亮。',
        build: () => themeDesktop({
            box: { surface: '#ffffff', text: '#1f2430' },
            bubble: {
                user: { fill: '#eef3ff', border: '#c7d6fb', borderWidth: 1, radius: 16 },
                character: { fill: '#ffffff', border: '#e4e7ee', borderWidth: 1, radius: 16 },
            },
            avatarShape: 'circle',
            avatarBorder: { user: '#c7d6fb', character: '#e4e7ee' },
            panel: { fill: '#ffffff', opacity: 94, blur: 16, radius: 18 },
            details: { scroll: '#c7d6fb', scrollTrack: '#f1f3f8', selection: '#cfe0ff', caret: '#4f7cff', separator: '#e4e7ee', tooltip: '#30364a', loader: '#4f7cff' },
            buttons: { color: '#4f7cff', fill: '#eef3ff', hover: '#dde8ff', pressed: '#cfe0ff' },
        }),
    },
    {
        key: 'ink-dark', label: '墨黑', description: '深色界面，浅紫蓝点缀，长时间使用更护眼。',
        build: () => themeDesktop({
            box: { surface: '#14161c', text: '#e8e8ee' },
            bubble: {
                user: { fill: '#23262f', border: '#343845', borderWidth: 1, radius: 16 },
                character: { fill: '#1b1d24', border: '#2b2e38', borderWidth: 1, radius: 16 },
            },
            avatarShape: 'circle',
            avatarBorder: { user: '#343845', character: '#2b2e38' },
            panel: { fill: '#1b1d24', opacity: 94, blur: 18, radius: 18 },
            details: { scroll: '#4b4f5c', scrollTrack: '#1b1d24', selection: '#3a3f6b', caret: '#7c9cff', separator: '#2b2e38', tooltip: '#2b2e38', loader: '#7c9cff' },
            buttons: { color: '#c8cdfb', fill: '#23262f', hover: '#2b2f3c', pressed: '#343845' },
        }),
    },
    {
        key: 'warm-paper', label: '暖纸', description: '米黄纸感，衬线字体，适合沉浸阅读的角色扮演。',
        build: () => themeDesktop({
            box: { surface: '#f7f1e6', text: '#4a3f33' },
            bubble: {
                user: { fill: '#f0e4cf', border: '#dfcba3', borderWidth: 1, radius: 14 },
                character: { fill: '#fffaf0', border: '#ead9b9', borderWidth: 1, radius: 14 },
            },
            avatarShape: 'round',
            avatarBorder: { user: '#dfcba3', character: '#ead9b9' },
            panel: { fill: '#fffaf0', opacity: 94, blur: 10, radius: 16 },
            details: { scroll: '#dab97e', scrollTrack: '#f0e4cf', selection: '#f0dba9', caret: '#b8793a', separator: '#ead9b9', tooltip: '#4a3f33', loader: '#b8793a' },
            buttons: { color: '#8a5a2b', fill: '#f0e4cf', hover: '#ead9b9', pressed: '#dfcba3' },
            font: 'serif',
        }),
    },
];

export function buildThemePreset(key, name) {
    const preset = THEME_PRESETS.find(item => item.key === key);
    if (!preset) throw new Error('未知的内置模板。');
    return parseTemplate({ ...blankTemplate(name), desktop: preset.build() });
}

export function parseTemplate(data) {
    if (!record(data) || data.format !== FORMAT || data.version !== VERSION ||
        !cleanName(data.name) || !record(data.desktop) || (data.mobile !== undefined && !record(data.mobile))) {
        throw new Error('模板格式或版本不受支持');
    }
    const menus = cleanMenus(data.menus, normalizeImageSource);
    const layoutLocks = cleanLayoutLocks(data.layoutLocks, SECTIONS);
    return {
        ...blankTemplate(cleanName(data.name)),
        desktop: cleanLayout(data.desktop),
        mobile: cleanLayout(data.mobile ?? {}),
        ...(Object.keys(menus).length ? { menus } : {}),
        ...(layoutLocks.length ? { layoutLocks } : {}),
    };
}

const materialKeys = [
    ...Object.keys(SECTIONS).filter(key => SECTIONS[key].fields.url),
    ...Object.keys(MENUS).map(id => 'menus.' + id),
];

export function materialImage(template, key, device) {
    if (key.startsWith('menus.')) {
        const id = key.slice(6);
        return {
            own: template.menus?.[id]?.[device]?.panel?.background,
            effective: menuView(template.menus, id, device === 'mobile').panel.background,
        };
    }
    return { own: template[device][key]?.url, effective: effectiveFields(template, device, key).url };
}

function writeMaterialImage(template, key, device, url) {
    if (key.startsWith('menus.')) {
        const menu = (template.menus ??= {})[key.slice(6)] ??= {};
        ((menu[device] ??= {}).panel ??= {}).background = url;
    } else {
        (template[device][key] ??= {}).url = url;
    }
}

export function groupMaterialUses(template) {
    const images = new Map();
    for (const device of ['desktop', 'mobile']) {
        for (const key of materialKeys) {
            const { own, effective } = materialImage(template, key, device);
            if (!effective) continue;
            if (!images.has(effective)) images.set(effective, []);
            images.get(effective).push({ key, device, inherited: own === undefined });
        }
    }
    return images;
}

export function findMaterialUses(template, url) {
    return url ? groupMaterialUses(template).get(url) ?? [] : [];
}

export function replaceMaterialUses(template, original, source, selected) {
    const url = normalizeImageSource(source);
    if (!url) throw new Error('请先选择照片或填写有效的 HTTPS 图片链接。');
    if (!original || original === url) return template;
    const positions = new Map();
    for (const { key, device } of selected) {
        if (!materialKeys.includes(key) || !['desktop', 'mobile'].includes(device) ||
            materialImage(template, key, device).effective !== original) continue;
        if (!positions.has(key)) positions.set(key, new Set());
        positions.get(key).add(device);
    }
    if (!positions.size) return template;
    const next = structuredClone(template);
    for (const [key, devices] of positions) {
        const phoneUrl = devices.has('mobile') ? url : materialImage(template, key, 'mobile').effective;
        if (devices.has('desktop')) writeMaterialImage(next, key, 'desktop', url);
        // Preserve inheritance if the phone already receives the intended image from the desktop.
        if (materialImage(next, key, 'mobile').effective !== phoneUrl) writeMaterialImage(next, key, 'mobile', phoneUrl);
    }
    return next;
}

export function applyMaterialBatch(template, source, positions, layers) {
    const url = normalizeImageSource(source);
    if (!url) throw new Error('请先选择照片或填写有效的 HTTPS 图片链接。');
    const next = structuredClone(template);
    for (const layer of layers) {
        if (layer !== 'desktop' && layer !== 'mobile') continue;
        for (const position of positions) {
            if (materialKeys.includes(position)) writeMaterialImage(next, position, layer, url);
        }
    }
    return next;
}

export function applyTemplateParts(destination, source, groups) {
    const target = parseTemplate(destination);
    const incoming = parseTemplate(source);
    const selected = new Set(groups);
    if (selected.has('nativeMenus') && incoming.menus) {
        target.menus ??= {};
        for (const [id, menu] of Object.entries(incoming.menus)) {
            const record = target.menus[id] ??= {};
            if (menu.groups) record.groups = { ...record.groups, ...menu.groups };
            for (const device of ['desktop', 'mobile']) {
                if (!menu[device]) continue;
                const layer = record[device] ??= {};
                for (const [key, values] of Object.entries(menu[device])) {
                    if (key === 'items') {
                        layer.items ??= {};
                        for (const [item, appearance] of Object.entries(values)) layer.items[item] = { ...layer.items[item], ...appearance };
                    } else layer[key] = { ...layer[key], ...values };
                }
            }
        }
    }
    for (const device of ['desktop', 'mobile']) {
        for (const [key, values] of Object.entries(incoming[device])) {
            if (selected.has(SECTIONS[key].group ?? key)) {
                target[device][key] = { ...target[device][key], ...values };
            }
        }
    }
    return target;
}

export function equalSettings(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) !== Array.isArray(right) || !left || !right ||
        typeof left !== 'object' || typeof right !== 'object') return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length &&
        keys.every(key => Object.hasOwn(right, key) && equalSettings(left[key], right[key]));
}

export function getLayoutReview(before, after) {
    const changes = { desktop: [], mobile: [], sharedMenus: [] };
    const fieldChanges = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
        .filter(key => !equalSettings(a?.[key], b?.[key]))
        .map(key => ({ key, from: a?.[key], to: b?.[key] }));
    for (const layer of ['desktop', 'mobile']) {
        for (const section of Object.keys(SECTIONS)) {
            const fields = fieldChanges(before[layer][section], after[layer][section]);
            if (fields.length) changes[layer].push({ section, fields });
        }
        for (const menu of ['global', ...Object.keys(MENUS)]) {
            const a = before.menus?.[menu]?.[layer];
            const b = after.menus?.[menu]?.[layer];
            const fields = ['panel', 'entry', 'itemStyle'].flatMap(area =>
                fieldChanges(a?.[area], b?.[area]).map(field => ({ ...field, area })));
            const items = fieldChanges(a?.items, b?.items).map(({ key, from, to }) =>
                ({ key, fields: fieldChanges(from, to) }));
            if (fields.length || items.length) changes[layer].push({ menu, fields, items });
        }
    }
    for (const menu of Object.keys(MENUS)) {
        if (!equalSettings(before.menus?.[menu]?.groups, after.menus?.[menu]?.groups)) changes.sharedMenus.push(menu);
    }
    return changes;
}

export function restoreReviewFields(template, baseline, updates) {
    const next = structuredClone(template);
    for (const { layer, change, field, item } of updates) {
        let values;
        if (change.section) {
            values = next[layer][change.section] ??= {};
        } else {
            const menu = (next.menus ??= {})[change.menu] ??= {};
            const target = menu[layer] ??= {};
            if (item) {
                const group = field.key === 'group' && field.from;
                if (group && group !== 'more' && !Object.hasOwn(menu.groups ?? {}, group)) {
                    const original = baseline.menus?.[change.menu]?.groups?.[group];
                    const groups = menu.groups ??= {};
                    if (!original || Object.keys(groups).length >= 20) {
                        throw new Error('无法恢复原分组，请在菜单中选择要使用的分组。');
                    }
                    groups[group] = original;
                }
                values = (target.items ??= {})[item] ??= {};
            } else {
                values = target[field.area] ??= {};
            }
        }
        if (field.from === undefined) delete values[field.key];
        else values[field.key] = field.from;
    }
    return parseTemplate(next);
}

export function restoreReviewField(template, baseline, layer, change, field, item) {
    return restoreReviewFields(template, baseline, [{ layer, change, field, item }]);
}

export function effectiveFields(template, device, section) {
    return {
        ...template.desktop[section],
        ...(device === 'mobile' ? template.mobile[section] : {}),
    };
}

export function cssString(text) {
    return '"' + text.replace(/["\\\u0000-\u001f\u007f<>@]/g, character => '\\' + character.codePointAt(0).toString(16) + ' ') + '"';
}

function rule(selector, declarations) {
    if (!Object.keys(declarations).length) return '';
    return selector + ' {\n' + Object.entries(declarations)
        .map(([property, value]) => '  ' + property + ': ' + value + ' !important;').join('\n') + '\n}\n';
}

const targets = { top: '#top-bar', chat: '#sheld > #chat', input: '#form_sheld > #send_form', page: 'body > #bg1' };
const ownColor = {
    top: 'var(--SmartThemeBlurTintColor)', chat: 'var(--SmartThemeChatTintColor)',
    input: 'var(--SmartThemeBlurTintColor)',
};

function background(v, section) {
    const css = {};
    if (v.color !== undefined || v.opacity !== undefined) {
        const base = v.color ?? ownColor[section];
        css['background-color'] = base;
        if (v.opacity !== undefined) {
            css['background-color'] = colorMix(base, v.opacity);
        }
    }
    return css;
}

function imageRules(selector, v, edges) {
    if (v.url === undefined && !edges) return '';
    const base = v.url === undefined ? '' : rule(selector, { 'background-image': 'none' });
    const layer = {
        content: '""', position: 'absolute', inset: '0',
        'pointer-events': 'none', 'border-radius': 'inherit', 'z-index': '-1',
    };
    const picture = v.url ? 'url(' + cssString(v.url) + ') ' + imagePosition(v) + ' / ' + imageSize(v) + ' no-repeat' : '';
    layer.background = picture || 'none';
    layer.filter = v.url ? 'brightness(' + (100 - (v.mask ?? 0)) + '%)' : 'none';
    layer.opacity = v.url ? (v.imageOpacity ?? 100) / 100 : 1;
    if (selector === targets.chat) {
        // Both sticky layers precede the messages in flex order. The negative
        // margin cancels each layer's height, leaving native scrolling intact.
        const sticky = {
            content: '""', 'pointer-events': 'none', 'border-radius': 'inherit',
            position: 'sticky', 'inset-block-start': '0', 'align-self': 'stretch',
            flex: '0 0 100cqh', 'margin-block-end': 'calc(0px - 100cqh)',
        };
        let result = base + rule(selector, { 'container-type': 'size', isolation: 'isolate' });
        if (v.url !== undefined) result += rule(selector + '::before', {
            ...sticky, order: '-2', 'z-index': '-2', background: layer.background, filter: layer.filter, opacity: layer.opacity,
        });
        if (edges) result += rule(selector + '::after', {
            ...sticky, order: '-1', 'z-index': '-1', background: edges.join(', ') || 'none',
        });
        result += '@supports not (height: 1cqh) {\n' +
            rule(selector, { background: [...(edges ?? []), picture].filter(Boolean).join(', ') || 'none' }) +
            rule(selector + '::before, ' + selector + '::after', { content: 'none' }) + '}\n';
        return result;
    }
    return base + rule(selector, { isolation: 'isolate', ...(selector === targets.input ? { position: 'relative' } : {}) }) +
        rule(selector + '::before', layer);
}

function boxRules(section, v, expanded) {
    const selector = targets[section];
    const sizing = {};
    const cosmetics = background(v, section);
    const minWidth = section === 'top' ? 300 : section === 'input' ? 240 : 160;
    if (expanded || ['width', 'maxWidth', 'marginX'].some(key => v[key] !== undefined)) {
        const nativeWidth = section === 'top' || expanded ? 'var(--tle-native-width, var(--sheldWidth))' : '100%';
        const available = 'calc(100% - ' + (v.marginX ?? 0) * 2 + 'px)';
        const width = v.width === undefined ? nativeWidth : v.width + '%';
        const maximum = v.maxWidth === undefined ? width : 'min(' + width + ', ' + v.maxWidth + 'px)';
        sizing.width = 'min(100%, max(' + minWidth + 'px, min(' + available + ', ' + maximum + ')))';
        sizing['max-width'] = '100%';
        sizing['margin-inline'] = 'auto';
        sizing['box-sizing'] = 'border-box';
    }
    if (v.radius !== undefined) cosmetics['border-radius'] = v.radius + 'px';
    const inner = {};
    if (v.paddingX !== undefined) inner['padding-inline'] = 'min(' + v.paddingX + 'px, 4vw)';
    if (v.paddingY !== undefined) inner['padding-block'] = v.paddingY + 'px';
    const vertical = {};
    if (v.marginY !== undefined) vertical['margin-block'] = v.marginY + 'px';
    if (section === 'top') {
        const shift = (v.paddingY ?? 0) * 2 + (v.marginY ?? 0) * 2;
        let result = rule(selector, { ...sizing, ...cosmetics }) +
            rule('#top-settings-holder', { ...sizing, ...inner, ...(sizing.width ? { 'inset-inline': '0' } : {}) });
        if (sizing.width || inner['padding-inline']) {
            result += rule('#top-settings-holder > .drawer', { 'min-width': 0 });
            result += rule('#top-settings-holder > .drawer .drawer-icon', { 'font-size': 'min(var(--topBarIconSize), 6.5vw, 24px)' });
        }
        if (v.marginY !== undefined || v.paddingY !== undefined) {
            const top = 'calc(var(--topBarBlockSize) + ' + shift + 'px)';
            result += rule('#top-settings-holder, #top-bar', {
                top: (v.marginY ?? 0) + 'px', height: 'calc(var(--topBarBlockSize) + ' + (v.paddingY ?? 0) * 2 + 'px)',
                'box-sizing': 'border-box',
            });
            result += rule('body:not(.waifuMode) #sheld', { top, height: 'calc(100dvh - ' + top + ' - 1px)', 'max-height': 'calc(100dvh - ' + top + ' - 1px)' });
            result += rule('#top-settings-holder .drawer-content', { top });
        }
        return result;
    }
    if (section === 'chat' && Object.keys(v).length) inner['min-height'] = '0';
    let result = rule(selector, { ...sizing, ...cosmetics, ...inner, ...vertical });
    if (section === 'input' && (sizing.width || inner['padding-inline'])) {
        result += rule('#send_form #send_textarea', { 'min-width': '40px' });
        result += rule('#send_form :is(#leftSendForm, #rightSendForm) > div', { width: 'min(var(--bottomFormBlockSize), 8.5vw, 34px)' });
    }
    return result;
}

const px = value => value + 'px';
const fontValue = { system: 'system-ui, sans-serif', serif: 'Georgia, serif', monospace: 'ui-monospace, monospace' };
const drawerKeys = new Set(['charactersPanel', 'worldPanel', 'settingsPanel', 'extensionsPanel']);
function colorMix(value, percent) {
    if (!value.startsWith('#')) return 'color-mix(in srgb, ' + value + ' ' + percent + '%, transparent)';
    const channels = value.slice(1).match(/../g).map(part => Number.parseInt(part, 16));
    return 'rgba(' + channels.join(', ') + ', ' + percent / 100 + ')';
}

function props(values, mapping) {
    const result = {};
    for (const [field, property, format] of mapping) {
        if (values[field] !== undefined) result[property] = format ? format(values[field]) : values[field];
    }
    return result;
}

function textStyle(v) {
    return props(v, [
        ['color', 'color'], ['fontSize', 'font-size', px], ['font', 'font-family', value => fontValue[value]],
        ['line', 'line-height', value => value / 100],
    ]);
}

function buttonRules(selector, v) {
    const css = props(v, [
        ['color', 'color'], ['fill', 'background-color'], ['radius', 'border-radius', px],
        ['fontSize', 'font-size', px], ['gap', 'margin-inline', value => 'min(' + px(value) + ', 1vw)'],
        ['hitSize', 'min-height', px],
    ]);
    if (v.hitSize !== undefined) css['min-width'] = 'min(' + px(v.hitSize) + ', 9vw)';
    let result = rule(selector, css);
    if (v.hover) result += rule(selector + ':hover', { 'background-color': v.hover });
    if (v.pressed) result += rule(selector + ':active', { 'background-color': v.pressed });
    if (v.disabled) result += rule(selector + ':is(:disabled, [aria-disabled="true"], .disabled)', { color: v.disabled });
    if (v.url) {
        const icon = {
            content: '""', display: 'inline-block', width: '1em', height: '1em',
            background: 'url(' + cssString(v.url) + ') center / contain no-repeat',
        };
        result += rule(selector + '::before', icon);
        if (selector === '#option_regenerate') result += rule(selector + ' > i', { display: 'none' });
    } else if (v.icon && v.icon !== 'native') {
        const icon = { content: '"\\' + iconCode[v.icon] + '"', 'font-family': '"Font Awesome 6 Free"', 'font-weight': 900 };
        if (selector === '#option_regenerate') result += rule(selector + ' > i::before', icon);
        else result += rule(selector + '::before', icon);
    }
    return result;
}

function panelRules(section, selector, v, device) {
    const css = props(v, [
        ['width', 'width', value => 'min(' + px(value) + ', 100dvw)'],
        ['radius', 'border-radius', px], ['blur', 'backdrop-filter', value => 'blur(' + px(value) + ')'],
    ]);
    if (v.fill || v.opacity !== undefined) css['background-color'] = colorMix(v.fill ?? 'var(--SmartThemeBlurTintColor)', v.opacity ?? 100);
    if (v.width !== undefined) {
        css['min-width'] = 'min(260px, 100dvw)';
        css['max-width'] = '100dvw';
    }
    let result = rule(selector, css) + imageRules(selector, v);
    if (device === 'mobile' && v.dock === 'bottom' && drawerKeys.has(section)) {
        result += rule(selector + '.openDrawer:not(.pinned):not(.maximized)', {
            position: 'fixed', 'inset-inline': '0', top: 'calc(100dvh - env(safe-area-inset-bottom, 0px))', bottom: 'auto',
            translate: '0 -100%', width: '100dvw', 'max-width': '100dvw', 'max-height': '75dvh', 'overflow-y': 'auto',
            margin: '0', 'border-radius': (v.radius ?? 16) + 'px ' + (v.radius ?? 16) + 'px 0 0',
        });
    }
    return result;
}

function detailsRules(v) {
    let css = '';
    if (v.scroll || v.scrollTrack) css += rule(':is(#chat, #top-settings-holder .drawer-content, dialog.popup)', { 'scrollbar-color': (v.scroll ?? 'var(--SmartThemeBorderColor)') + ' ' + (v.scrollTrack ?? 'transparent') });
    if (v.selection) css += rule(':is(#chat, #send_textarea, #top-settings-holder .drawer-content) ::selection, #send_textarea::selection', { 'background-color': v.selection });
    if (v.caret) css += rule('#send_textarea', { 'caret-color': v.caret });
    if (v.separator) css += rule(':is(#chat, #top-settings-holder .drawer-content) hr', { 'border-color': v.separator });
    if (v.tooltip) css += rule('#toast-container :is(.toast-info, .toast-warning)', { 'background-color': v.tooltip });
    if (v.loader) css += rule(':is(.action-loader-message, .api_loading, #mes_stop)', { color: v.loader });
    if (v.motion === 'fade' || v.loadingMotion === 'pulse') {
        css += '@keyframes tle-detail-fade { from { opacity: 0; } to { opacity: 1; } }\n';
        css += '@keyframes tle-detail-pulse { 50% { opacity: .45; } }\n';
    }
    if (v.motion) css += rule('#top-settings-holder .drawer-content.openDrawer', { animation: v.motion === 'fade' ? 'tle-detail-fade .18s ease both' : 'none' });
    if (v.loadingMotion) css += rule(':is(.action-loader-message, .api_loading, #mes_stop:not(.displayNone))', { animation: v.loadingMotion === 'pulse' ? 'tle-detail-pulse 1.3s ease infinite' : 'none' });
    if (v.motion === 'fade' || v.loadingMotion === 'pulse') css += '@media (prefers-reduced-motion: reduce) {\n' +
        rule('#top-settings-holder .drawer-content.openDrawer, :is(.action-loader-message, .api_loading, #mes_stop:not(.displayNone))', { animation: 'none' }) + '}\n';
    return css;
}

function chatFrameLayers(template, device) {
    const layers = [];
    let configured = false;
    for (const [key] of frameSections) {
        const v = effectiveFields(template, device, key);
        if (v.url !== undefined) configured = true;
        if (!v.url) continue;
        const side = key.slice('chatFrame'.length);
        const horizontal = side === 'top' || side === 'bottom';
        const thickness = 'min(' + (v.sizePx ?? 38) + 'px, ' + (horizontal ? '14vh' : '15vw') + ')';
        const stretch = v.repeat === 'stretch';
        const size = horizontal ? (stretch ? '100%' : 'auto') + ' ' + thickness
            : thickness + ' ' + (stretch ? '100%' : 'auto');
        const repeat = stretch ? 'no-repeat' : horizontal ? 'repeat-x' : 'repeat-y';
        layers.push('url(' + cssString(v.url) + ') ' + side + ' center / ' + size + ' ' + repeat);
    }
    return configured ? layers : undefined;
}

function decorationRules(section, selector, v) {
    if (v.url === undefined && v.text === undefined) return '';
    const art = {
        content: cssString(v.text ?? ''), 'pointer-events': 'none', 'white-space': 'pre-line',
        ...textStyle(v),
    };
    const picture = v.url ? 'url(' + cssString(v.url) + ')' : 'none';
    const size = v.sizePx ?? 80;
    const effect = v.mask ? 'brightness(' + (100 - v.mask) + '%)' : undefined;
    if (section === 'cover') return rule(selector, {
        'background-image': picture, 'background-size': imageSize(v),
        'background-position': imagePosition(v), 'background-repeat': 'no-repeat',
    }) + (v.text !== undefined ? rule(selector + '::before', art) : '');
    if (section === 'logo' || section === 'sticker' || section === 'greeting') {
        Object.assign(art, {
            position: 'absolute', width: 'min(' + size + 'px, 25vw)', 'min-height': 'min(' + size + 'px, 25vw)',
            'text-align': 'center', 'z-index': 1,
        });
        if (section === 'logo') Object.assign(art, { left: '4px', top: '0', width: 'min(' + size + 'px, 12vw)', 'max-height': '100%', 'min-height': '100%', overflow: 'hidden' });
        if (section === 'sticker') Object.assign(art, { right: '4px', bottom: 'max(78px, 14%)' });
        if (section === 'greeting') Object.assign(art, { inset: '20% 10% auto', width: '80%' });
    } else {
        Object.assign(art, { display: v.url || v.text ? 'block' : 'none', 'text-align': 'center', 'min-height': v.url ? 'min(' + size + 'px, 12vw)' : '0' });
    }
    art.background = picture + ' ' + imagePosition(v) + ' / ' + imageSize(v, 'contain') + ' no-repeat';
    if (v.imageOpacity !== undefined) art.opacity = v.imageOpacity / 100;
    if (effect) art.filter = effect;
    return rule(selector + '::after', art);
}

function extraRules(section, v, device) {
    const { kind, selector } = SECTIONS[section];
    if (kind === 'typography') return rule(selector, textStyle(v));
    if (kind === 'message') {
        const css = { ...textStyle(v), ...props(v, [
            ['border', 'border-color'], ['borderWidth', 'border-width', px], ['radius', 'border-radius', px],
            ['padding', 'padding', px], ['gap', 'margin-block-end', px],
        ]) };
        if (v.fill || v.opacity !== undefined) css['background-color'] = colorMix(v.fill ?? 'var(--SmartThemeChatTintColor)', v.opacity ?? 100);
        if (v.border || v.borderWidth !== undefined) css['border-style'] = 'solid';
        if (v.align) {
            css.flex = v.align === 'stretch' ? '1 1 auto' : '0 1 auto';
            css['margin-inline-start'] = ['center', 'right'].includes(v.align) ? 'auto' : '0';
            css['margin-inline-end'] = ['center', 'left'].includes(v.align) ? 'auto' : '0';
            css['max-width'] = '100%';
            css['min-width'] = '0';
        }
        return rule(selector, css) + rule(selector + ' > .mes_text', textStyle(v));
    }
    if (kind === 'avatar') {
        const css = props(v, [
            ['sizePx', 'width', value => 'min(' + px(value) + ', 18vw)'],
            ['sizePx', 'height', value => 'min(' + px(value) + ', 18vw)'],
            ['shape', 'border-radius', value => ({ circle: '50%', round: '22%', square: '0' })[value]],
            ['border', 'border-color'], ['borderWidth', 'border-width', px],
        ]);
        if (v.border || v.borderWidth !== undefined) css['border-style'] = 'solid';
        const wrapper = selector.replace(/ img$/, '');
        const dimensions = Object.fromEntries(Object.entries(css).filter(([key]) => ['width', 'height', 'border-radius'].includes(key)));
        return rule(wrapper, dimensions) + rule(selector, css);
    }
    if (kind === 'panel') return panelRules(section, selector, v, device);
    if (kind === 'details') return detailsRules(v);
    if (section === 'topPendant') {
        if (v.url === undefined) return '';
        const aligned = v.align === 'left' || v.align === 'right';
        const x = 'clamp(-22vw, ' + (v.offsetX ?? 0) + 'px, 22vw)';
        const y = 'clamp(-15vh, ' + (v.offsetY ?? 0) + 'px, 20vh)';
        return rule(selector + '::after', {
            content: '""', position: 'absolute', top: '100%', 'pointer-events': 'none',
            left: v.align === 'right' ? 'auto' : v.align === 'left' ? '4px' : '50%',
            right: v.align === 'right' ? '4px' : 'auto',
            transform: v.offsetX !== undefined || v.offsetY !== undefined
                ? (aligned ? '' : 'translateX(-50%) ') + 'translate(' + x + ', ' + y + ')'
                : aligned ? 'none' : 'translateX(-50%)',
            width: 'min(' + (v.sizePx ?? 92) + 'px, 65vw)',
            height: 'min(' + (v.height ?? 68) + 'px, 22vh)',
            background: v.url ? 'url(' + cssString(v.url) + ') center top / contain no-repeat' : 'none',
            opacity: (v.imageOpacity ?? 100) / 100,
        });
    }
    if (kind === 'art') return decorationRules(section, selector, v);
    return '';
}

export function matchScene(template, { chat, character, hour }) {
    const v = template.desktop.scene;
    if (!v || !(v.chat || v.character || (v.period && v.period !== 'any'))) return -1;
    if (v.chat && v.chat !== String(chat ?? '')) return -1;
    if (v.character && v.character !== character) return -1;
    const day = hour >= 6 && hour < 18;
    if ((v.period === 'day' && !day) || (v.period === 'night' && day)) return -1;
    return (v.chat ? 4 : 0) + (v.character ? 2 : 0) + (v.period && v.period !== 'any' ? 1 : 0);
}

function messageInfoRules(values, runtime) {
    let css = '';
    for (const [key, target] of Object.entries(MESSAGE_INFO)) {
        const mode = values[key];
        const selector = '#chat .mes ' + (key === 'model' && !runtime ? '.timestamp-icon' : target);
        if (mode === 'hide') css += rule(selector, { display: 'none' });
        if (mode === 'show' || (runtime && mode === 'details')) {
            css += rule(selector + ':not(:empty)', { display: 'inline-block' });
            if (key === 'model') css += rule('#chat .mes .timestamp-icon', { display: 'inline-block' });
        }
        if (runtime && mode === 'details') css += rule('#chat .mes:not([data-tle-meta-open]) ' + target, { display: 'none' });
    }
    if (values.reasoning === 'hide') css += rule('#chat .mes .mes_reasoning_details', { display: 'none' });
    return css;
}

function layoutRules(template, device, runtime) {
    const expanded = ['chat', 'input'].some(section => effectiveFields(template, device, section).width !== undefined);
    let css = expanded ? rule('#sheld', { width: '100%', 'max-width': '100%' }) : '';
    for (const section of Object.keys(targets)) {
        const pane = section === 'chat' || section === 'input';
        const v = effectiveFields(template, device, section);
        const sizedTop = section === 'top' && ['width', 'maxWidth', 'marginX'].some(key => v[key] !== undefined);
        const edgeOverride = section === 'chat' && frameSections.some(([key]) => template.mobile[key]);
        if (device === 'mobile' && !template.mobile[section] && !(expanded && pane) && !sizedTop && !edgeOverride) continue;
        if (device === 'mobile' && sizedTop) css += rule('#top-bar, #top-settings-holder', { '--tle-native-width': '100%' });
        if (device === 'mobile' && expanded && pane) css += rule(targets[section], { '--tle-native-width': '100%' });
        if (section === 'page') {
            const typography = {};
            if (v.fontSize !== undefined) typography['--mainFontSize'] = v.fontSize + 'px';
            if (v.textColor !== undefined) {
                typography['--SmartThemeBodyColor'] = v.textColor;
                typography.color = v.textColor;
            }
            if (v.fontSize !== undefined) typography['font-size'] = 'var(--mainFontSize)';
            css += rule('body', typography);
        } else {
            css += boxRules(section, v, expanded && pane);
        }
        css += imageRules(targets[section], v, section === 'chat' ? chatFrameLayers(template, device) : undefined);
    }
    for (const [key, [, selector]] of Object.entries(buttons)) {
        if (key === 'topButton' || (key === 'bottomButton' && !runtime)) continue;
        const individualTop = Object.hasOwn(topButtons, key);
        const mobileOverride = template.mobile.buttonGroup || template.mobile[key] || (individualTop && template.mobile.topButton);
        if (device === 'mobile' && !mobileOverride) continue;
        const values = effectiveFields(template, device, 'buttonGroup');
        for (const scope of individualTop ? ['topButton', key] : [key]) {
            const individual = effectiveFields(template, device, scope);
            if (individual.icon !== undefined && individual.url === undefined) delete values.url;
            Object.assign(values, individual);
        }
        const rules = buttonRules(selector, values);
        if (rules) css += device === 'desktop' && mobileOverride
            ? '@media screen and (min-width: ' + (BREAKPOINT + 1) + 'px) {\n' + rules + '}\n'
            : rules;
    }
    for (const [section, descriptor] of Object.entries(extraSections)) {
        if (descriptor.kind === 'messageInfo') {
            const overrides = template.mobile[section];
            if (device === 'desktop' || overrides) {
                const rules = messageInfoRules(effectiveFields(template, device, section), runtime);
                if (rules) css += device === 'desktop' && overrides
                    ? '@media screen and (width > ' + BREAKPOINT + 'px) {\n' + rules + '}\n'
                    : rules;
            }
            continue;
        }
        if (descriptor.kind === 'button' || descriptor.kind === 'runtime') continue;
        if (device === 'mobile' && !template.mobile[section] && !(drawerKeys.has(section) && template.desktop[section]?.dock === 'bottom')) continue;
        css += extraRules(section, effectiveFields(template, device, section), device);
    }
    return css;
}

export function compileCss(template, { runtime = false } = {}) {
    const clean = parseTemplate(template);
    const desktop = layoutRules(clean, 'desktop', runtime);
    const mobile = layoutRules(clean, 'mobile', runtime);
    return desktop + (mobile ? '@media screen and (max-width: ' + BREAKPOINT + 'px) {\n' + mobile + '}\n' : '') +
        compileMenuCss(clean.menus, cssString, BREAKPOINT, runtime);
}

export function getShareSummary(template) {
    const notes = runtimeMenuFeatures(template.menus);
    const added = new Set();
    for (const layer of ['desktop', 'mobile']) {
        const launcher = effectiveFields(template, layer, 'launcher');
        if (launcher.entries && launcher.entries !== 'none') added.add('输入栏新增入口，如「换主题」和「返回底部」');
        if (Object.keys(effectiveFields(template, layer, 'bottomButton')).length) added.add('「返回底部」扩展按钮样式');
        const info = effectiveFields(template, layer, 'messageInfo');
        if (Object.values(info).includes('details')) added.add('消息信息的「点开看」按钮');
        if (['show', 'details'].includes(info.model)) added.add('消息里的模型名称文字');
        if (['expanded', 'collapsed'].includes(info.reasoning)) added.add('推理过程的初始展开或折叠状态');
    }
    const scene = template.desktop.scene;
    if (scene && (scene.chat || scene.character || (scene.period && scene.period !== 'any'))) {
        added.add('按聊天、角色或时段选择模板的场景条件');
    }
    const composer = effectiveFields(template, 'mobile', 'mobileComposer');
    if (Object.keys(COMPOSER_BUTTONS).some(key => ['left', 'right'].includes(composer[key]) ||
        composer[key + 'Order'] !== undefined)) added.add('手机输入栏按钮重排');
    if (composer.more === 'on') added.add('手机输入栏「消息更多」快捷操作');

    const isLocal = url => typeof url === 'string' && url.startsWith('data:image/');
    const hasPhoto = layer => Object.values(layer).some(fields => isLocal(fields.url));
    const menusHavePhoto = Object.values(template.menus ?? {}).some(menu => ['desktop', 'mobile'].some(layer => {
        const values = menu[layer];
        return isLocal(values?.panel?.background) || isLocal(values?.entry?.icon) || isLocal(values?.itemStyle?.icon) ||
            Object.values(values?.items ?? {}).some(item => isLocal(item.icon));
    }));
    return {
        runtimeFeatures: [...notes, ...added],
        hasLocalPhotos: hasPhoto(template.desktop) || hasPhoto(template.mobile) || menusHavePhoto,
    };
}

export const BEGIN = '/* BEGIN 酒馆布局编辑器 */';
export const END = '/* END 酒馆布局编辑器 */';

export function mergeTheme(snapshot, template) {
    let customCss = String(snapshot.custom_css ?? '');
    const block = BEGIN + '\n' + compileCss(template) + END;
    // Match only complete, standalone markers. Leave all user CSS and whitespace intact.
    const escapedBegin = BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp('^' + escapedBegin + '\\r?\\n[\\s\\S]*?^' + escapedEnd + '(?=\\r?$)', 'gm');
    let replaced = false;
    customCss = customCss.replace(matcher, () => {
        if (replaced) return '';
        replaced = true;
        return block;
    });
    if (!replaced) customCss += (customCss ? '\n\n' : '') + block;
    return { ...snapshot, custom_css: customCss };
}


