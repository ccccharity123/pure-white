import * as hostApp from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { getThemeObject, power_user } from '/scripts/power-user.js';
import { download } from '/scripts/utils.js';
import { getContext } from '/scripts/st-context.js';
import { createRuntime } from './runtime.js';
import { createMenuRuntime } from './menu-runtime.js';
import { createMenuEditor } from './menu-editor.js';
import { MENUS, runtimeMenuFeatures } from './menus.mjs';
import { createCustomization } from './customization.js';
import { BREAKPOINT, GROUPS, SECTIONS, applyTemplateParts, blankTemplate, cleanField, cleanName, compileCss, effectiveFields, matchScene, mergeTheme, normalizeUrl, parseTemplate } from './model.mjs';

const KEY = 'tavern_layout_editor';
const TITLE = '纯白';
const { eventSource, event_types, saveSettings } = hostApp;
const isTauriTavern = () => Boolean(window.__TAURITAVERN__ || window.__TAURITAVERN_MAIN_READY__);
const LIMIT = 100;
const menuId = 'tle-menu';
const templateId = () => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(18)), byte => byte.toString(16).padStart(2, '0'));
    return hex.join('');
};

let saved;
let draft;
let panel;
let body;
let status;
let message;
let menu;
let style;
let ready;
let section = 'top';
let page = 'menus';
let zone = '';
let pickedMenu = false;
let previewMenu = '';
let editorViewport;
let device = 'desktop';
let pendingImport = 0;
let importedParts;
let partsSource = '';
let applying = false;
let picking = false;
let pickButton;
let sceneActive;
let sceneTimer;
const sceneSettings = input => ({ auto: input?.auto === true, manual: input?.manual === true });
const invalidUrls = new Map();
const images = new Map();

function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (className) node.className = className;
    return node;
}

function button(label, action, className = 'menu_button') {
    const node = element('button', label, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
}

function readSettings() {
    const input = extension_settings[KEY];
    const templates = {};
    for (const [id, value] of Object.entries(input?.templates ?? {}).slice(0, LIMIT)) {
        if (!/^[a-f0-9-]{36}$/.test(id)) continue;
        try {
            templates[id] = parseTemplate(value);
        } catch {
            // An invalid entry must not prevent the remaining layouts loading.
        }
    }
    const active = Object.hasOwn(templates, input?.active) ? input.active : Object.keys(templates)[0];
    if (active) return { active, templates, ...sceneSettings(input) };
    const id = templateId();
    return { active: id, templates: { [id]: blankTemplate() }, ...sceneSettings() };
}

function savedLayout() {
    return saved?.templates[sceneActive ?? saved.active];
}

function current() {
    return draft ? draft.templates[draft.active] : savedLayout();
}

function sceneContext() {
    const host = getContext();
    return { chat: host.chatId, character: host.groupId ? undefined : host.characters[host.characterId]?.name, hour: new Date().getHours() };
}

const customization = createCustomization(isTauriTavern);
const nativeMenus = createMenuRuntime();
const menuEditor = createMenuEditor({
    getTemplate: current, setMessage, getItems: nativeMenus.items, button,
    onPreview(id, event) {
        event.stopPropagation();
        const definition = MENUS[id];
        const trigger = document.querySelector(definition.trigger);
        const popup = document.querySelector(definition.panel);
        if (!trigger || !popup) return;
        if (getComputedStyle(popup).display === 'none') {
            trigger.focus({ preventScroll: true });
            trigger.click();
        }
        setPicking(true);
        previewMenu = id;
        panel.dataset.preview = 'true';
        pickButton.textContent = '返回编辑';
        pickButton.focus({ preventScroll: true });
    },
    onChange() {
        draft.templates[draft.active] = parseTemplate(current());
        refreshPreview();
        updateStatus();
    },
});

const runtime = createRuntime({
    getLayout: savedLayout,
    openTemplates: () => {
        openEditor('templates');
    },
    scrollToBottom() {
        if (typeof hostApp.getChatScrollHeight === 'function' && typeof hostApp.setChatScrollTop === 'function') {
            hostApp.setChatScrollTop(hostApp.getChatScrollHeight());
        } else {
            const chat = document.querySelector('#chat');
            if (chat) chat.scrollTop = chat.scrollHeight;
        }
    },
});

function reconcileScene(force = false) {
    if (!saved) return;
    let best;
    let score = -1;
    if (saved.auto && !saved.manual) {
        const context = sceneContext();
        for (const [id, template] of Object.entries(saved.templates)) {
            const match = matchScene(template, context);
            if (match <= score) continue;
            score = match;
            best = id;
        }
    }
    if (force || best !== sceneActive) {
        sceneActive = best;
        runtime.update();
        refreshPreview();
    }
}

function onChatChanged() {
    reconcileScene();
}

function updateStatus() {
    if (!panel) return;
    const comparable = { ...saved, active: sceneActive ?? saved.active };
    const dirty = invalidUrls.size || JSON.stringify(comparable) !== JSON.stringify(draft);
    status.textContent = current().name + (dirty ? ' · 未保存' : ' · 已保存') +
        (draft.auto && !draft.manual && draft.active === sceneActive ? ' · 场景自动切换' : '');
    status.dataset.dirty = dirty ? 'true' : 'false';
}

function setMessage(text) {
    if (message) message.textContent = text;
}

function imageState(url) {
    if (!images.has(url)) {
        const image = new Image();
        image.referrerPolicy = 'no-referrer';
        images.set(url, { image, status: 'loading' });
        const complete = result => {
            const entry = images.get(url);
            if (!entry || entry.image !== image) return;
            entry.status = result;
            refreshPreview();
            refreshThumbnail();
        };
        image.onload = () => complete('loaded');
        image.onerror = () => complete('failed');
        image.src = url;
    }
    return images.get(url).status;
}

function refreshPreview() {
    if (!saved) return;
    const template = structuredClone(current());
    customization.update(template);
    nativeMenus.update(template.menus);
    const activeUrls = new Set();
    for (const layout of [template.desktop, template.mobile]) {
        for (const fields of Object.values(layout)) {
            if (fields.url) {
                activeUrls.add(fields.url);
                if (imageState(fields.url) !== 'loaded') fields.url = '';
            }
        }
    }
    for (const url of images.keys()) {
        if (!activeUrls.has(url)) images.delete(url);
    }
    const css = compileCss(template, { runtime: true });
    if (!css) {
        style?.remove();
        style = undefined;
        return;
    }
    style ??= element('style');
    style.id = 'tle-layout-style';
    if (style.textContent !== css) style.textContent = css;
    if (document.head.lastElementChild !== style) document.head.append(style);
}

function refreshThumbnail() {
    const thumb = body?.querySelector('.tle-thumbnail');
    if (!thumb) return;
    const feedback = thumb.nextElementSibling;
    const url = effectiveFields(current(), device, section).url;
    const invalid = invalidUrls.has(section + '/' + device);
    const result = !invalid && url ? imageState(url) : '';
    if (result === 'loaded' && thumb.getAttribute('src') !== url) thumb.src = url;
    if (result !== 'loaded') thumb.removeAttribute('src');
    thumb.hidden = result !== 'loaded';
    feedback.textContent = invalid ? '请输入有效的 HTTPS 图片直链。' : ({
        loaded: '图片已加载。',
        failed: '图片加载失败，已保留底色。',
        loading: '正在加载图片…',
    }[result] ?? '未设置图片。');
}

function changeField(key, value) {
    const layout = current()[device];
    if (value === undefined) {
        delete layout[section]?.[key];
        if (layout[section] && !Object.keys(layout[section]).length) delete layout[section];
    } else {
        (layout[section] ??= {})[key] = value;
    }
    refreshPreview();
    refreshThumbnail();
    updateStatus();
    const indicator = body?.querySelector('#tle-field-state-' + key);
    if (indicator) indicator.textContent = current().mobile[section]?.[key] === undefined ? '继承桌面' : '手机已覆盖';
}

function renderField(key, field) {
    const row = element('div', '', 'tle-field');
    const own = current()[device][section]?.[key];
    const effective = effectiveFields(current(), device, section)[key];
    const id = 'tle-field-' + key;
    const fieldLabel = field.label + (field.unit ? '（' + field.unit + '）' : '');
    const label = element('label', fieldLabel);
    label.htmlFor = id;
    row.append(label);
    if (device === 'mobile' && section !== 'mobileComposer') {
        const state = element('small', own === undefined ? '继承桌面' : '手机已覆盖', 'tle-field-state');
        state.id = 'tle-field-state-' + key;
        label.append(state);
    }

    let input;
    const urlKey = section + '/' + device;
    if (field.type === 'select') {
        input = element('select', '', 'text_pole');
        input.add(new Option(device === 'mobile' ? '继承桌面' : '默认', ''));
        for (const [value, text] of Object.entries(field.options)) input.add(new Option(text, value));
        input.value = own ?? '';
        input.addEventListener('change', () => changeField(key, input.value || undefined));
    } else {
        input = element('input', '', 'text_pole');
        input.type = field.type;
        input.value = own ?? '';
        if (field.type === 'number') {
            input.min = field.min;
            input.max = field.max;
            input.placeholder = String(effective ?? '');
            const slider = element('input');
            slider.type = 'range';
            slider.min = field.min;
            slider.max = field.max;
            slider.value = own ?? effective ?? field.suggested;
            slider.setAttribute('aria-label', field.label + '滑块（' + field.unit + '）');
            slider.addEventListener('input', () => {
                input.value = slider.value;
                changeField(key, Number(slider.value));
            });
            input.addEventListener('input', () => {
                const value = cleanField(field, input.valueAsNumber);
                slider.value = value ?? effective ?? field.suggested;
                changeField(key, value);
            });
            input.addEventListener('change', () => {
                if (input.value) input.value = current()[device][section]?.[key] ?? '';
            });
            row.append(slider);
        } else if (field.type === 'color') {
            input.value = own ?? effective ?? '#222222';
            input.addEventListener('input', () => changeField(key, input.value));
        } else if (field.type === 'text') {
            input.maxLength = field.max;
            input.placeholder = field.hint || String(effective ?? '');
            input.addEventListener('input', () => changeField(key, cleanField(field, input.value) || undefined));
        } else {
            input.value = invalidUrls.get(urlKey) ?? own ?? '';
            input.placeholder = effective || 'https://…';
            input.maxLength = 2048;
            input.spellcheck = false;
            input.autocomplete = 'off';
            input.setAttribute('aria-invalid', String(invalidUrls.has(urlKey)));
            input.addEventListener('input', () => {
                const clean = normalizeUrl(input.value);
                input.setAttribute('aria-invalid', String(clean === undefined));
                if (clean === undefined) {
                    invalidUrls.set(urlKey, input.value);
                    refreshThumbnail();
                    updateStatus();
                } else {
                    invalidUrls.delete(urlKey);
                    changeField(key, clean || undefined);
                }
            });
        }
    }

    input.id = id;
    input.setAttribute('aria-label', fieldLabel);
    if (device === 'mobile' && section !== 'mobileComposer') input.setAttribute('aria-describedby', 'tle-field-state-' + key);
    row.append(input);
    if (field.type === 'url') {
        row.classList.add('tle-url');
        row.append(button('清空图片', () => {
            invalidUrls.delete(urlKey);
            changeField(key, device === 'mobile' ? '' : undefined);
            renderBody();
        }));
        if (own === '' && device === 'mobile') row.append(element('small', '移动端图片已清空'));
    }
    if (field.type !== 'select') {
        row.append(button(device === 'mobile' ? '继承' : '默认', () => {
            if (field.type === 'url') invalidUrls.delete(urlKey);
            changeField(key, undefined);
            renderBody();
        }));
    }
    return row;
}

function selectTemplate(id) {
    draft.active = id;
    if (draft.auto) draft.manual = true;
    invalidUrls.clear();
    renderBody();
    refreshPreview();
    updateStatus();
}

function addTemplate(template) {
    if (Object.keys(draft.templates).length >= LIMIT) throw new Error('最多保存 ' + LIMIT + ' 个模板');
    const id = templateId();
    draft.templates[id] = template;
    selectTemplate(id);
}

function jsonDownload(data, name) {
    download(JSON.stringify(data, null, 4), name.replace(/[\\/:*?"<>|]/g, '_') + '.json', 'application/json');
}

function renderPartialApply() {
    const area = element('details', '', 'tle-partial');
    area.append(element('summary', '局部套用模板'));
    const source = element('select', '', 'text_pole');
    source.setAttribute('aria-label', '局部套用来源');
    source.add(new Option('选择模板', ''));
    if (importedParts) source.add(new Option('已导入：' + importedParts.name, 'file'));
    for (const [id, template] of Object.entries(draft.templates)) {
        if (id !== draft.active) source.add(new Option(template.name, id));
    }
    source.value = partsSource;
    const checklist = element('fieldset', '', 'tle-part-list');
    checklist.append(element('legend', '选择要套用的区域'));
    const file = element('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', async () => {
        const selected = file.files?.[0];
        const opening = draft;
        const ticket = ++pendingImport;
        file.value = '';
        if (!selected) return;
        try {
            if (selected.size > 128 * 1024) throw new Error('模板文件超过 128 KB');
            const template = parseTemplate(JSON.parse(await selected.text()));
            if (draft !== opening || ticket !== pendingImport || !area.isConnected) return;
            importedParts = template;
            if (source.querySelector('option[value="file"]')) source.remove(1);
            source.add(new Option('已导入：' + template.name, 'file'), 1);
            source.value = 'file';
            partsSource = 'file';
            renderChoices();
        } catch (error) {
            if (draft === opening && ticket === pendingImport) setMessage('导入失败：' + error.message);
        }
    });
    const incoming = () => source.value === 'file' ? importedParts : draft.templates[source.value];
    function renderChoices() {
        checklist.querySelectorAll('label').forEach(label => label.remove());
        const selected = incoming();
        if (!selected) return;
        const groups = new Map();
        for (const layer of [selected.desktop, selected.mobile]) {
            for (const id of Object.keys(layer)) {
                const region = SECTIONS[id];
                const key = region.group ?? id;
                groups.set(key, GROUPS[key] ?? region.label);
            }
        }
        if (selected.menus) groups.set('nativeMenus', '原生菜单');
        for (const [key, label] of groups) {
            const check = element('input');
            check.type = 'checkbox';
            check.value = key;
            const row = element('label', '', 'tle-checkbox');
            row.append(check, label);
            checklist.append(row);
        }
    }
    source.addEventListener('change', () => {
        partsSource = source.value;
        renderChoices();
    });
    const merge = button('套用所选区域', () => {
        const selected = incoming();
        const groups = [...checklist.querySelectorAll('input:checked')].map(input => input.value);
        if (!selected || !groups.length) return setMessage('请先选择来源模板和要套用的区域。');
        draft.templates[draft.active] = applyTemplateParts(current(), selected, groups);
        for (const device of ['desktop', 'mobile']) {
            for (const [id, values] of Object.entries(selected[device])) {
                if ('url' in values && groups.includes(SECTIONS[id].group ?? id)) invalidUrls.delete(id + '/' + device);
            }
        }
        refreshPreview();
        updateStatus();
        setMessage('已套用所选区域。点击「保存修改」保存，或点击「取消」撤销。');
    });
    area.append(source, file, button('从文件选择来源', () => file.click()), checklist, merge);
    renderChoices();
    return area;
}

function renderTemplates() {
    const select = element('select', '', 'text_pole');
    select.setAttribute('aria-label', '当前模板');
    for (const [id, layout] of Object.entries(draft.templates)) select.add(new Option(layout.name, id));
    select.value = draft.active;
    select.addEventListener('change', () => {
        selectTemplate(select.value);
        setMessage('');
    });
    const name = element('input', '', 'text_pole');
    name.type = 'text';
    name.maxLength = 80;
    name.placeholder = '输入名称后新建、另存或重命名';
    name.setAttribute('aria-label', '模板名称');
    const withName = action => () => {
        const value = cleanName(name.value);
        if (!value) return setMessage('请先输入模板名称。');
        try {
            setMessage('');
            action(value);
        } catch (error) {
            setMessage(error.message);
        }
    };
    const actions = element('div', '', 'tle-actions');
    actions.append(
        button('新建', withName(value => addTemplate(blankTemplate(value)))),
        button('另存', withName(value => addTemplate({ ...structuredClone(current()), name: value }))),
        button('重命名', withName(value => {
            current().name = value;
            renderBody();
            updateStatus();
        })),
        button('删除当前模板', () => {
            delete draft.templates[draft.active];
            const [first] = Object.keys(draft.templates);
            if (first) selectTemplate(first);
            else addTemplate(blankTemplate());
            setMessage('删除已暂存，可用「取消」撤销。');
        }),
    );

    const file = element('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', async () => {
        const selected = file.files?.[0];
        const opening = draft;
        const ticket = ++pendingImport;
        file.value = '';
        if (!selected) return;
        try {
            if (selected.size > 128 * 1024) throw new Error('模板文件超过 128 KB');
            const template = parseTemplate(JSON.parse(await selected.text()));
            if (draft !== opening || ticket !== pendingImport) return;
            addTemplate(template);
            setMessage('模板已导入。可继续编辑，或点击「保存修改」保存。');
        } catch (error) {
            if (draft === opening && ticket === pendingImport) setMessage('导入失败：' + error.message);
        }
    });

    const sharing = element('section', '', 'tle-share-card');
    const validate = action => () => {
        if (invalidUrls.size) return setMessage('请先修正或清空无效图片 URL。');
        action();
    };
    const themeName = element('input', '', 'text_pole');
    themeName.type = 'text';
    themeName.maxLength = 80;
    themeName.placeholder = '原生主题名称（选填）';
    themeName.setAttribute('aria-label', '原生主题名称');
    const shareOption = (title, description, action) => {
        const choice = button('', action, 'tle-share-option');
        choice.setAttribute('aria-label', title);
        const text = element('span');
        text.append(element('strong', title), element('small', description));
        const arrow = element('span', '↓', 'tle-share-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        choice.append(text, arrow);
        return choice;
    };
    sharing.append(element('h3', '分享'), shareOption('完整模板（含排序和分组）',
        '发给安装了纯白的朋友，可继续编辑。', validate(() => jsonDownload(parseTemplate(current()), current().name))));
    const native = shareOption('酒馆主题（静态外观）', '可从酒馆原生主题菜单导入。', validate(() => {
        const title = cleanName(themeName.value) || cleanName(power_user.theme + ' · ' + current().name);
        const snapshot = getThemeObject(title);
        jsonDownload(mergeTheme(snapshot, current()), title);
        setMessage('已导出。请在酒馆的 UI 主题菜单导入，然后选中该主题。');
    }));
    const auto = element('input');
    auto.type = 'checkbox';
    auto.checked = draft.auto;
    const autoLabel = element('label', '', 'tle-checkbox');
    autoLabel.append(auto, '按聊天、角色或本地时段自动切换');
    auto.addEventListener('change', () => {
        draft.auto = auto.checked;
        draft.manual = false;
        renderBody();
        updateStatus();
    });
    const manual = button(draft.manual ? '恢复场景自动切换' : '手动固定当前模板', () => {
        draft.manual = !draft.manual;
        renderBody();
        updateStatus();
    });
    const management = element('details', '', 'tle-ui-disclosure');
    management.append(element('summary', '管理模板'), name, actions, autoLabel);
    if (draft.auto) management.append(manual);
    management.append(button('恢复当前模板默认', () => {
        draft.templates[draft.active] = blankTemplate(current().name);
        invalidUrls.clear();
        setMessage('已预览默认布局。点击「保存修改」应用。');
        renderBody();
        refreshPreview();
        updateStatus();
    }));
    const templateCard = element('section', '', 'tle-template-card');
    const toolbar = element('div', '', 'tle-actions');
    toolbar.append(button('另存为', () => {
        management.open = true;
        name.focus();
        management.scrollIntoView({ block: 'nearest' });
    }), button('导入模板', () => file.click()));
    templateCard.append(element('h3', '当前模板'), select, toolbar);
    const menuFeatures = runtimeMenuFeatures(current().menus);
    sharing.append(native);
    const shareOptions = element('details', '', 'tle-ui-disclosure');
    shareOptions.append(element('summary', '主题名称与分享说明'), themeName);
    body.append(file, templateCard, sharing, shareOptions, management, renderPartialApply());
    if (menuFeatures.length) {
        const notice = element('section', '', 'tle-export-notice');
        notice.append(element('strong', '以下菜单效果需安装纯白并导入可编辑模板'));
        const list = element('ul');
        for (const feature of menuFeatures) list.append(element('li', feature));
        notice.append(list);
        shareOptions.append(notice);
    }

}

const zones = {
    top: ['顶栏', ['top', 'topPendant', 'topButton', 'logo', ...Object.keys(SECTIONS).filter(key => SECTIONS[key].selector?.endsWith(' .drawer-icon') && key !== 'topButton')]],
    chat: ['聊天消息', ['chat', ...Object.keys(SECTIONS).filter(key => SECTIONS[key].group === 'messages'), 'swipeButton', 'editButton', 'copyButton', 'divider']],
    input: ['输入栏', ['input', 'sendButton', 'stopButton', 'regenerateButton', 'wandButton', 'moreButton', 'bottomButton', 'mobileComposer', 'launcher']],
    page: ['页面背景', ['page', 'cover', 'greeting', 'sticker']],
    other: ['其他面板', []],
};
const assigned = new Set(Object.values(zones).flatMap(([, keys]) => keys));
zones.other[1].push(...Object.keys(SECTIONS).filter(key => !assigned.has(key)));

const appearanceMap = [
    ['top', '顶栏', 'top'], ['topPendant', '顶栏下方挂件', 'pendant'],
    ['chatFrametop', '消息区上边', 'edge-top'],
    ['chatFrameleft', '消息区左边', 'edge-left'], ['chat', '聊天消息', 'chat'], ['chatFrameright', '消息区右边', 'edge-right'],
    ['chatFramebottom', '消息区下边', 'edge-bottom'], ['input', '输入栏', 'input'],
    ['page', '页面背景', 'page'], [zones.other[1][0], '其他面板', 'other'],
];
const appearanceSearch = Object.entries(SECTIONS).flatMap(([key, descriptor]) =>
    Object.entries(descriptor.fields).map(([field, config]) => ({
        key, field, label: descriptor.label + ' · ' + config.label,
    })));

function chooseAppearance(key, field) {
    section = key;
    zone = Object.keys(zones).find(name => zones[name][1].includes(key)) ?? 'other';
    if (key === 'scene') device = 'desktop';
    if (key === 'mobileComposer') device = 'mobile';
    setMessage('');
    renderBody();
    if (field) {
        const input = document.getElementById('tle-field-' + field);
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({ block: 'center' });
    }
}

function renderAppearanceNavigation() {
    const devices = element('div', '', 'tle-segments tle-appearance-devices');
    devices.setAttribute('aria-label', '外观编辑设备');
    for (const [key, label] of [['desktop', '桌面设置'], ['mobile', '手机设置']]) {
        const control = button(label, () => { device = key; renderBody(); });
        control.setAttribute('aria-pressed', String(device === key));
        devices.append(control);
    }
    body.append(devices);
    const map = element('div', '', 'tle-appearance-map');
    map.setAttribute('role', 'group');
    map.setAttribute('aria-label', '酒馆外观示意图');
    for (const [key, label, slot] of appearanceMap) {
        const control = button(label, () => chooseAppearance(key));
        control.dataset.mapSlot = slot;
        control.setAttribute('aria-pressed', String(Boolean(zone && key === section)));
        map.append(control);
    }
    body.append(map);
    const tools = element('div', '', 'tle-appearance-tools');
    const fallback = element('details', '', 'tle-ui-disclosure');
    const select = element('select');
    select.setAttribute('aria-label', '全部外观对象');
    select.add(new Option('选择外观对象', ''));
    for (const [label, keys] of Object.values(zones)) {
        const group = element('optgroup');
        group.label = label;
        for (const key of keys) group.append(new Option(SECTIONS[key].label, key));
        select.append(group);
    }
    select.value = zone ? section : '';
    select.addEventListener('change', () => { if (select.value) chooseAppearance(select.value); });
    fallback.append(element('summary', '用列表选择'), select);
    const search = element('details', '', 'tle-ui-disclosure');
    const input = element('input');
    input.type = 'search';
    input.placeholder = '例如：圆角、透明度、挂件';
    input.setAttribute('aria-label', '搜索设置');
    const results = element('div', '', 'tle-appearance-results');
    input.addEventListener('input', () => {
        results.replaceChildren();
        const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;
        const match = appearanceSearch.filter(item => words.every(word => item.label.toLowerCase().includes(word)));
        if (!match.length) results.append(element('small', '没有匹配的设置'));
        for (const item of match) results.append(button(item.label, () => chooseAppearance(item.key, item.field)));
    });
    search.append(element('summary', '搜索设置'), input, results);
    tools.append(fallback, search);
    body.append(tools);
}

function renderBody() {
    for (const tab of panel.querySelectorAll('[data-section]')) tab.setAttribute('aria-pressed', String(tab.dataset.section === page));
    body.replaceChildren();
    body.scrollTop = 0;
    if (page === 'templates') {
        renderTemplates();
        return;
    }
    if (page === 'menus') {
        menuEditor.render(body, false, pickedMenu);
        pickedMenu = false;
        return;
    }
    renderAppearanceNavigation();
    if (!zone) return;
    const descriptor = SECTIONS[section];
    const group = descriptor.group;
    const selection = element('select', '', 'text_pole tle-area-select');
    selection.setAttribute('aria-label', '编辑对象');
    for (const id of zones[zone][1]) selection.add(new Option(SECTIONS[id].label, id));
    selection.value = section;
    selection.addEventListener('change', () => {
        section = selection.value;
        if (section === 'scene') device = 'desktop';
        if (section === 'mobileComposer') device = 'mobile';
        setMessage('');
        renderBody();
    });
    body.append(selection);
    if (section === 'mobileComposer') body.append(element('small', '仅在宽度 ≤ ' + BREAKPOINT + ' px 时生效。数字越小越靠前。「消息更多」操作当前最后一条消息。'));
    if (section === 'messageInfo') body.append(element('small', '显示已有的消息信息。模型名称和 Token 数需由酒馆保存。'));
    if (group === 'runtime') body.append(element('small', (isTauriTavern() ? '当前宿主为 TauriTavern。' : '当前宿主为 SillyTavern。') +
        '此组效果由纯白运行，需要安装扩展。'));
    if (group === 'panels' && isTauriTavern()) body.append(element('small', '底部抽屉样式适用于这四个原生抽屉，TauriTavern 专属面板沿用宿主布局。'));
    if (section === 'scene') {
        body.append(element('small', '在「模板」开启自动切换。聊天匹配优先于角色匹配，时段用本地时间。'));
        const context = sceneContext();
        const actions = element('div', '', 'tle-actions');
        if (context.chat) actions.append(button('填入当前聊天 ID', () => {
            changeField('chat', String(context.chat));
            renderBody();
        }));
        if (context.character) actions.append(button('填入当前角色', () => {
            changeField('character', context.character);
            renderBody();
        }));
        body.append(actions);
    }
    for (const [key, field] of Object.entries(descriptor.fields)) {
        body.append(renderField(key, field));
        if (key === 'url') {
            const thumb = element('img', '', 'tle-thumbnail');
            thumb.alt = '背景图片预览';
            thumb.referrerPolicy = 'no-referrer';
            const feedback = element('small', '', 'tle-image-status');
            feedback.setAttribute('role', 'status');
            body.append(thumb, feedback);
        }
    }
    refreshThumbnail();
}

function setPicking(value) {
    picking = value;
    if (!panel) return;
    if (!value && previewMenu) {
        const definition = MENUS[previewMenu];
        previewMenu = '';
        delete panel.dataset.preview;
        const popup = document.querySelector(definition.panel);
        if (popup && getComputedStyle(popup).display !== 'none') document.querySelector(definition.trigger)?.click();
    }
    panel.dataset.picking = String(value);
    pickButton.textContent = value ? '取消点选' : '点选酒馆里的元素';
    pickButton.setAttribute('aria-pressed', String(value));
}

const directTargets = Object.entries(SECTIONS)
    .filter(([key, part]) => part.selector && !['details', 'greeting', 'sticker', 'cover', 'logo', 'divider'].includes(key))
    .sort((a, b) => Number(b[1].kind === 'button' || b[1].kind === 'typography') - Number(a[1].kind === 'button' || a[1].kind === 'typography'));
const baseTargets = [['top', '#top-settings-holder, #top-bar'], ['input', '#send_form'], ['chat', '#chat'], ['page', '#bg1']];

function pickElement(event) {
    if (!picking || previewMenu || !(event.target instanceof Element) || panel?.contains(event.target)) return;
    const target = event.target;
    const menu = nativeMenus.hit(target);
    if (menu) {
        // Let the host open a closed menu. An open menu's trigger selects the entry.
        if (menu.scope === 'entry' && !menu.open) {
            pickButton.textContent = '取消点选（请点菜单项目或面板）';
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        page = 'menus';
        pickedMenu = true;
        menuEditor.select(menu, matchMedia('(max-width: ' + BREAKPOINT + 'px)').matches);
        setPicking(false);
        document.querySelector(MENUS[menu.id].trigger)?.click();
        renderBody();
        return;
    }
    const direct = directTargets.find(([, part]) => target.closest(part.selector));
    const fallback = baseTargets.find(([, selector]) => target.closest(selector));
    const key = direct?.[0] ?? fallback?.[0];
    if (!key) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    section = key;
    page = 'appearance';
    zone = Object.keys(zones).find(name => zones[name][1].includes(key)) ?? 'other';
    device = matchMedia('(max-width: ' + BREAKPOINT + 'px)').matches ? 'mobile' : 'desktop';
    setPicking(false);
    renderBody();
    setMessage('已选中「' + SECTIONS[key].label + '」。');
}

function closeEditor() {
    setPicking(false);
    editorViewport?.abort();
    editorViewport = undefined;
    panel?.remove();
    panel = body = status = message = draft = undefined;
    invalidUrls.clear();
    importedParts = undefined;
    partsSource = '';
    refreshPreview();
    (document.querySelector('#extensionsMenuButton') ?? menu?.firstElementChild)?.focus();
}

function openEditor(initial) {
    if (applying) return;
    if (panel) {
        if (initial === 'templates') {
            page = 'templates';
            renderBody();
        }
        panel.querySelector('h2').focus();
        return;
    }
    page = initial === 'templates' ? 'templates' : 'menus';
    zone = '';
    device = matchMedia('(max-width: ' + BREAKPOINT + 'px)').matches ? 'mobile' : 'desktop';
    menuEditor.reset();
    draft = structuredClone(saved);
    draft.active = sceneActive ?? saved.active;
    panel = element('section');
    panel.id = 'tle-editor';
    panel.setAttribute('aria-labelledby', 'tle-title');
    const heading = element('h2', TITLE);
    heading.id = 'tle-title';
    heading.tabIndex = -1;
    status = element('div', '', 'tle-status');
    const tabs = element('nav', '', 'tle-actions tle-tabs');
    tabs.setAttribute('aria-label', '布局区域');
    for (const [key, label] of [['menus', '菜单'], ['appearance', '界面外观'], ['templates', '我的模板']]) {
        const tab = button(label, () => {
            page = key;
            setMessage('');
            renderBody();
        });
        tab.dataset.section = key;
        tabs.append(tab);
    }
    body = element('div', '', 'tle-body');
    message = element('div', '', 'tle-message');
    message.setAttribute('role', 'status');
    const actions = element('footer', '', 'tle-actions');
    actions.append(
        button('取消', closeEditor),
        button('保存修改', async () => {
            if (applying) return;
            if (invalidUrls.size) return setMessage('请先修正或清空无效图片 URL。');
            const next = structuredClone(draft);
            if (next.auto && !next.manual && saved.templates[saved.active] && next.templates[saved.active]) next.active = saved.active;
            saved = next;
            sceneActive = undefined;
            extension_settings[KEY] = saved;
            applying = true;
            closeEditor();
            reconcileScene(true);
            try {
                await saveSettings();
            } finally {
                applying = false;
            }
        }, 'menu_button tle-primary'),
    );
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (picking) setPicking(false);
            else closeEditor();
        }
    });
    pickButton = button('点选酒馆里的元素', event => {
        if (previewMenu) event.stopPropagation();
        setPicking(!picking);
    }, 'menu_button tle-pick');
    const header = element('header', '', 'tle-ui-header');
    const titleRow = element('div', '', 'tle-title-row');
    titleRow.append(heading, status);
    header.append(titleRow, tabs, pickButton);
    panel.append(header, body, message, actions);
    document.body.append(panel);
    editorViewport = new AbortController();
    const opts = { signal: editorViewport.signal };
    const fit = () => {
        const viewport = window.visualViewport;
        if (!panel || !viewport) return;
        const occluded = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        panel.style.setProperty('--tle-ui-height', viewport.height + 'px');
        panel.style.setProperty('--tle-ui-bottom', occluded + 'px');
        const focused = document.activeElement;
        if (focused && body.contains(focused) && focused.matches('input, select, textarea')) {
            focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    };
    window.visualViewport?.addEventListener('resize', fit, opts);
    window.visualViewport?.addEventListener('scroll', fit, opts);
    window.addEventListener('resize', fit, opts);
    fit();
    renderBody();
    updateStatus();
    heading.focus();
}

function mount() {
    if (menu || !ready) return;
    const parent = document.getElementById('extensionsMenu');
    if (!parent) return;
    saved = readSettings();
    menu = element('div', '', 'list-group-item');
    const launcher = button(TITLE, openEditor, 'flex-container flexGap5');
    launcher.id = menuId;
    const icon = element('i', '', 'fa-solid fa-table-columns extensionsMenuExtensionButton');
    icon.setAttribute('aria-hidden', 'true');
    launcher.prepend(icon);
    menu.append(launcher);
    parent.append(menu);
    runtime.start();
    customization.start();
    nativeMenus.start();
    sceneTimer = setInterval(onChatChanged, 30_000);
    reconcileScene(true);
}

function onReady() {
    ready = true;
    mount();
}

function onSettings() {
    if (!menu) return;
    saved = readSettings();
    sceneActive = undefined;
    if (panel) closeEditor();
    reconcileScene(true);
}

export function activate() {
    eventSource.on(event_types.APP_READY, onReady);
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, onSettings);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    document.addEventListener('click', pickElement, true);
    if (document.getElementById('extensionsMenu')) onReady();
}

export function disable() {
    eventSource.removeListener(event_types.APP_READY, onReady);
    eventSource.removeListener(event_types.EXTENSION_SETTINGS_LOADED, onSettings);
    eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);
    document.removeEventListener('click', pickElement, true);
    clearInterval(sceneTimer);
    runtime.stop();
    customization.stop();
    nativeMenus.stop();
    sceneActive = undefined;
    saved = undefined;
    closeEditor();
    style?.remove();
    style = undefined;
    menu?.remove();
    menu = undefined;
    ready = false;
    images.clear();
}
