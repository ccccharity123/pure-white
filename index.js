import { applyLayout, devices, layoutChanges, layoutFields, layoutPrompt, layoutStarts, layoutFormat, layoutValue, lockId, readLayoutProposal } from './ai-layout.mjs';
import { createPhotoPicker, MAX_TEMPLATE_FILE } from './image-assets.mjs';
import * as hostApp from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { getThemeObject, power_user } from '/scripts/power-user.js';
import { download } from '/scripts/utils.js';
import { getContext } from '/scripts/st-context.js';
import { createRuntime } from './runtime.js';
import { createMenuRuntime } from './menu-runtime.js';
import { createMenuEditor } from './menu-editor.js';
import { MENUS, menuView, runtimeMenuFeatures } from './menus.mjs';
import { createCustomization } from './customization.js';
import { BREAKPOINT, GROUPS, MAX_MATERIAL_FAVORITES, SECTIONS, applyMaterialBatch, applyTemplateParts, blankTemplate, cleanField, cleanMaterialFavorites, cleanName, compileCss, effectiveFields, equalSettings, getLayoutReview, matchScene, mergeTheme, normalizeUrl, parseTemplate } from './model.mjs';

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
let history;
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
let aiPreview;
let openingLayout;
let openingTemplateId;
let reviewReturn = 'menus';
let aiGoal = '';
const aiSessions = new Map();
let materialKey = '';
const recentMaterials = new Map();
let refreshMaterialShelf;
let refreshMaterialIndex;
const materialIndex = { query: '', filter: 'all', open: false };
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
    const materialFavorites = cleanMaterialFavorites(input?.materialFavorites);
    if (active) return { active, templates, materialFavorites, ...sceneSettings(input) };
    const id = templateId();
    return { active: id, templates: { [id]: blankTemplate() }, materialFavorites, ...sceneSettings(input) };
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
    layoutLock: layoutLockButton,
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

function draftSnapshot() {
    return JSON.stringify({ draft, invalid: [...invalidUrls] });
}

function updateHistory() {
    const state = draftSnapshot();
    if (history.entries[history.index] !== state) {
        history.entries.splice(history.index + 1);
        const focused = document.activeElement;
        const field = body.contains(focused) && focused.matches('input:not([type=checkbox], [type=radio], [type=file], [type=button])') ? focused : null;
        if (field && history.field === field) history.entries[history.index] = state;
        else {
            history.entries.push(state);
            while (history.entries.length > 2 && (history.entries.length > 40 ||
                history.entries.reduce((length, value) => length + value.length, 0) > 6 * 1024 * 1024)) history.entries.shift();
            history.index = history.entries.length - 1;
        }
        history.field = field;
    }
    history.undo.disabled = history.index === 0;
    history.redo.disabled = history.index + 1 === history.entries.length;
}

function stepHistory(direction) {
    const index = history.index + direction;
    if (index < 0 || index >= history.entries.length) return;
    const previous = JSON.parse(history.entries[index]);
    history.index = index;
    history.field = null;
    draft = previous.draft;
    invalidUrls.clear();
    for (const [key, value] of previous.invalid) invalidUrls.set(key, value);
    const scroll = body.scrollTop;
    renderBody();
    body.scrollTop = scroll;
    refreshPreview();
    updateStatus();
}

function updateStatus() {
    if (!panel) return;
    if (history) updateHistory();
    const comparable = { ...saved, active: sceneActive ?? saved.active };
    const dirty = invalidUrls.size || JSON.stringify(comparable) !== JSON.stringify(draft);
    status.textContent = current().name + (dirty ? ' · 未保存' : ' · 已保存') +
        (draft.auto && !draft.manual && draft.active === sceneActive ? ' · 场景自动切换' : '');
    status.dataset.dirty = dirty ? 'true' : 'false';
    refreshMaterialIndex?.();
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
    const comparison = panel?.dataset.aiOriginal ? (page === 'review' ? openingLayout : current()) : undefined;
    const template = structuredClone(comparison ?? aiPreview ?? current());
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

function setLayoutLock(id, enabled) {
    const active = new Set(current().layoutLocks);
    if (enabled) active.add(id);
    else active.delete(id);
    if (active.size) current().layoutLocks = [...active].sort();
    else delete current().layoutLocks;
    updateStatus();
}

const aiFields = layoutFields(SECTIONS);
function layoutLockButton(layer, area, key) {
    const field = aiFields.find(item => item.area === area && item.key === key);
    if (!field) return null;
    const id = lockId(layer, field);
    const control = button('锁定给 AI', () => {
        const locked = !current().layoutLocks?.includes(id);
        setLayoutLock(id, locked);
        sync();
        setMessage(locked ? '下次 AI 排版将保留此项。' : 'AI 可以重新调整此项。');
    }, 'menu_button tle-ai-lock');
    function sync() {
        control.setAttribute('aria-pressed', String(Boolean(current().layoutLocks?.includes(id))));
    }
    control.setAttribute('aria-label', '锁定给 AI：' + field.label);
    sync();
    return control;
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
            input.value = invalidUrls.get(urlKey) ?? (own?.startsWith('data:') ? '' : own) ?? '';
            input.placeholder = effective?.startsWith('data:') ? '已使用本地照片' : effective || 'https://…';
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
        input.addEventListener('change', () => {
            const url = normalizeUrl(input.value);
            if (url) rememberMaterial(url, SECTIONS[section].label);
        });
        row.append(createPhotoPicker({
            label: fieldLabel, setMessage, urlInput: input,
            onSelect(value) {
                invalidUrls.delete(urlKey);
                changeField(key, value);
                rememberMaterial(value, SECTIONS[section].label);
            },
        }));
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
    const lock = layoutLockButton(device, section, key);
    if (lock) row.append(lock);
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
            if (selected.size > MAX_TEMPLATE_FILE) throw new Error('模板文件超过 12 MB');
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
            if (selected.size > MAX_TEMPLATE_FILE) throw new Error('模板文件超过 12 MB');
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
        const disclosure = input?.closest('details');
        if (disclosure) disclosure.open = true;
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({ block: 'center' });
    } else {
        body.querySelector('.tle-quick-appearance h3')?.scrollIntoView({ block: 'nearest' });
    }
}

function renderDeviceTransfer() {
    const controls = element('details', '', 'tle-ui-disclosure');
    controls.append(element('summary', '复制或重置设备设置'));
    const caption = element('small', '仅影响「' + SECTIONS[section].label + '」。复制会合并来源设备中已设定的字段。');
    const actions = element('div', '', 'tle-actions');
    function transfer(source, target) {
        const template = current();
        const values = template[source][section];
        if (!values || !Object.keys(values).length) return setMessage('来源设备没有设置可复制。');
        template[target][section] = { ...template[target][section], ...values };
        if (Object.hasOwn(values, 'url')) invalidUrls.delete(section + '/' + target);
        device = target;
        renderBody();
        updateStatus();
        refreshPreview();
        setMessage(target === 'mobile' ? '已复制到手机设置。' : '已复制到桌面设置。');
    }
    actions.append(
        button('复制桌面到手机', () => transfer('desktop', 'mobile')),
        button('复制手机到桌面', () => transfer('mobile', 'desktop')),
        button('手机恢复继承', () => {
            delete current().mobile[section];
            invalidUrls.delete(section + '/mobile');
            device = 'mobile';
            renderBody();
            updateStatus();
            refreshPreview();
            setMessage('当前对象的手机设置已恢复继承。');
        }),
    );
    controls.append(caption, actions);
    return controls;
}

function renderFrameBatch() {
    const detail = element('details', '', 'tle-ui-disclosure');
    detail.append(element('summary', '批量换消息区边框'));
    const choices = element('div', '', 'tle-actions');
    for (const [key, label, slot] of appearanceMap.filter(([, , slot]) => slot.startsWith('edge-'))) {
        const row = element('label', '', 'tle-checkbox');
        const check = element('input');
        check.type = 'checkbox';
        check.value = key;
        check.checked = true;
        row.append(check, label);
        choices.append(row);
    }
    const input = element('input');
    input.type = 'url';
    input.setAttribute('aria-label', '批量边框图片 URL');
    input.placeholder = '粘贴 HTTPS 图片 URL';
    function apply(url) {
        const selected = [...choices.querySelectorAll('input:checked')];
        if (!selected.length) return setMessage('请至少选择一边。'), false;
        for (const check of selected) {
            const target = current()[device][check.value] ??= {};
            target.url = url;
            invalidUrls.delete(check.value + '/' + device);
        }
        rememberMaterial(url, '消息区边框');
        refreshPreview();
        refreshThumbnail();
        updateStatus();
        setMessage('已为所选边框换图。');
        return true;
    }
    const photos = createPhotoPicker({ label: '批量边框', urlInput: input, setMessage,
        canSelect: () => Boolean(choices.querySelector('input:checked')), onSelect: apply });
    const submit = button('应用到所选边', () => {
        const url = normalizeUrl(input.value);
        if (!url) return setMessage('请填写有效的 HTTPS 图片 URL。');
        apply(url);
    });
    detail.append(choices, input, photos, submit);
    return detail;
}

const quickFields = {
    top: ['width', 'radius', 'color'],
    topPendant: ['url', 'sizePx', 'align'],
    chat: ['width', 'radius', 'color'],
    input: ['width', 'radius', 'color'],
    page: ['url', 'fontSize', 'textColor'],
};

function renderAppearanceFields(descriptor, materials = false) {
    const all = Object.entries(descriptor.fields);
    const preferred = quickFields[section] ??
        (descriptor.group === 'buttons' ? ['url', 'icon', 'color', 'fontSize'] :
            ['url', 'sizePx', 'repeat', 'fill', 'radius', 'width', 'color']);
    const materialKeys = ['url', 'icon', 'size', 'position', 'imageOpacity', 'mask', 'sizePx', 'height', 'align', 'repeat'];
    const ordered = (materials ? materialKeys : preferred).filter(key => Object.hasOwn(descriptor.fields, key)).slice(0, materials ? materialKeys.length : 4);
    const quick = new Set(ordered.length ? ordered : all.slice(0, 3).map(([key]) => key));
    const card = element('section', '', 'tle-edit-card tle-quick-appearance');
    const heading = element('h3', descriptor.label);
    heading.tabIndex = -1;
    card.append(heading);
    const details = element('details', '', 'tle-ui-disclosure');
    details.append(element('summary', '全部设置'));
    const add = (parent, key, field) => {
        parent.append(renderField(key, field));
        if (key === 'url') {
            const thumb = element('img', '', 'tle-thumbnail');
            thumb.alt = '背景图片预览';
            thumb.referrerPolicy = 'no-referrer';
            const feedback = element('small', '', 'tle-image-status');
            feedback.setAttribute('role', 'status');
            parent.append(thumb, feedback);
        }
    };
    for (const key of quick) add(card, key, descriptor.fields[key]);
    for (const [key, field] of all) if (!quick.has(key)) add(details, key, field);
    if (details.childElementCount > 1) card.append(details);
    body.append(card);
}

function editorLink(label, target) {
    return button(label, () => {
        page = target;
        setMessage('');
        renderBody();
    });
}

function renderAiLayout() {
    let session = aiSessions.get(draft.active);
    if (!session) {
        session = { source: '', proposal: [], excluded: new Set(), scope: 'all' };
        aiSessions.set(draft.active, session);
    }
    const card = element('section', '', 'tle-edit-card tle-ai-layout');
    const goal = element('textarea', '', 'text_pole');
    goal.setAttribute('aria-label', '排版需求');
    goal.placeholder = '例如：桌面聊天区收窄，手机单列、尽量铺满';
    goal.maxLength = 2000;
    goal.value = aiGoal;
    goal.addEventListener('input', () => { aiGoal = goal.value; });
    const prompt = element('textarea', '', 'text_pole');
    prompt.setAttribute('aria-label', '排版提示词');
    prompt.readOnly = true;
    prompt.hidden = true;
    const copy = button('复制提示词', async () => {
        prompt.value = layoutPrompt(current(), SECTIONS, goal.value);
        prompt.hidden = false;
        prompt.select();
        try {
            await navigator.clipboard.writeText(prompt.value);
            setMessage('已复制提示词。把它发给常用 AI。');
        } catch {
            setMessage('提示词已选中，可用系统菜单复制。');
        }
    });

    const locks = element('details', '', 'tle-ui-disclosure');
    const keyList = element('select', '', 'text_pole');
    keyList.setAttribute('aria-label', '要锁定的尺寸');
    const lockFields = aiFields;
    for (const [index, field] of lockFields.entries()) keyList.add(new Option(field.label, index));
    const lockedList = element('ul');
    const lockSummary = element('summary');
    const renderLocks = () => {
        const active = current().layoutLocks ?? [];
        lockSummary.textContent = '锁定手调尺寸（' + active.length + '）';
        lockedList.replaceChildren();
        for (const layer of devices) {
            for (const field of lockFields) {
                const id = lockId(layer, field);
                if (!active.includes(id)) continue;
                const label = (layer === 'desktop' ? '桌面' : '手机') + ' · ' + field.label;
                const row = element('li');
                row.append(element('span', label), button('解锁 ' + label, () => changeLock(id, false)));
                lockedList.append(row);
            }
        }
    };
    function changeLock(id, enabled) {
        setLayoutLock(id, enabled);
        renderLocks();
        review();
    }
    const lockActions = element('div', '', 'tle-actions');
    for (const [layer, label] of [['desktop', '锁定桌面尺寸'], ['mobile', '锁定手机尺寸']]) {
        lockActions.append(button(label, () => changeLock(lockId(layer, lockFields[keyList.value]), true)));
    }
    locks.append(lockSummary, keyList, lockActions, lockedList);
    renderLocks();

    const source = element('textarea', '', 'text_pole');
    source.setAttribute('aria-label', 'AI 排版 JSON');
    source.placeholder = '粘贴 AI 返回的 JSON';
    source.value = session.source;
    const results = element('div', '', 'tle-ai-results');
    let inputRevision = 0;
    let live = false;
    function clearPreview() {
        aiPreview = undefined;
        refreshPreview();
    }
    source.addEventListener('input', () => {
        inputRevision++;
        session.source = source.value;
        session.proposal = [];
        session.excluded.clear();
        live = false;
        results.replaceChildren();
        if (aiPreview) clearPreview();
        setMessage('');
    });
    function review(autoPreview = false) {
        clearPreview();
        results.replaceChildren();
        live = autoPreview;
        const changes = layoutChanges(current(), session.proposal);
        if (!changes.length) {
            if (session.proposal.length) results.append(element('p', '当前方案的参数已锁定或与草稿相同。'));
            return;
        }
        const selection = () => layoutChanges(current(), changes.filter(field =>
            (session.scope === 'all' || session.scope === field.device) &&
            !session.excluded.has(lockId(field.device, field))));
        const scope = element('div', '', 'tle-segments');
        scope.setAttribute('role', 'group');
        scope.setAttribute('aria-label', '套用设备范围');
        for (const [key, label] of [['all', '两端一起套'], ['desktop', '只套桌面'], ['mobile', '只套手机']]) {
            const control = button(label, () => {
                session.scope = key;
                review(live);
                results.querySelector('[data-ai-scope="' + key + '"]')?.focus({ preventScroll: true });
            });
            control.dataset.aiScope = key;
            control.setAttribute('aria-pressed', String(session.scope === key));
            scope.append(control);
        }
        const selectedCount = element('small');
        selectedCount.setAttribute('aria-live', 'polite');
        const syncPreview = () => {
            const fields = selection();
            selectedCount.textContent = '已选 ' + fields.length + ' 项';
            if (!live) return;
            aiPreview = fields.length ? applyLayout(current(), fields) : undefined;
            refreshPreview();
        };
        for (const layer of devices) {
            if (session.scope !== 'all' && session.scope !== layer) continue;
            const candidates = changes.filter(field => field.device === layer);
            if (!candidates.length) continue;
            const group = element('fieldset');
            group.append(element('legend', layer === 'desktop' ? '桌面' : '手机'));
            for (const area of new Set(candidates.map(field => field.area))) {
                const fields = candidates.filter(field => field.area === area);
                const toggle = element('input');
                toggle.type = 'checkbox';
                const label = element('label', '', 'tle-checkbox');
                const name = fields[0].menu ? MENUS[fields[0].menu].label : SECTIONS[area].label;
                label.append(toggle, name + '（' + fields.length + ' 项）');
                const details = element('details', '', 'tle-ui-disclosure');
                details.append(element('summary', '查看 ' + name + ' 的改动'));
                const items = fields.map(field => {
                    const before = layoutValue(current(), layer, field) ?? (layer === 'desktop' ? '默认' : '继承');
                    const id = lockId(layer, field);
                    const check = element('input');
                    check.type = 'checkbox';
                    check.checked = !session.excluded.has(id);
                    const item = element('div', '', 'tle-ai-field-change');
                    const choice = element('label', '', 'tle-checkbox');
                    const caption = element('span');
                    const updateLabel = () => {
                        caption.textContent = field.label + '：' + before + ' → ' + field.value + ' ' + field.unit;
                    };
                    updateLabel();
                    choice.append(check, caption);
                    const input = element('input');
                    input.type = 'number';
                    input.min = field.min;
                    input.max = field.max;
                    input.step = 1;
                    input.value = field.value;
                    input.setAttribute('aria-label', '微调 ' + field.label + '（' + field.unit + '）');
                    input.addEventListener('change', () => {
                        const value = input.valueAsNumber;
                        if (!Number.isInteger(value) || value < field.min || value > field.max) {
                            input.value = field.value;
                            setMessage('请输入 ' + field.min + ' 到 ' + field.max + ' 之间的整数。');
                            return;
                        }
                        field.value = value;
                        updateLabel();
                        setMessage('');
                        syncPreview();
                    });
                    item.append(choice, input);
                    details.append(item);
                    return { check, id };
                });
                const syncArea = () => {
                    toggle.checked = items.every(item => item.check.checked);
                    toggle.indeterminate = !toggle.checked && items.some(item => item.check.checked);
                };
                const selectItem = ({ check, id }, checked) => {
                    check.checked = checked;
                    if (checked) session.excluded.delete(id);
                    else session.excluded.add(id);
                };
                toggle.addEventListener('change', () => {
                    for (const item of items) selectItem(item, toggle.checked);
                    syncArea();
                    syncPreview();
                });
                for (const item of items) item.check.addEventListener('change', () => {
                    selectItem(item, item.check.checked);
                    syncArea();
                    syncPreview();
                });
                syncArea();
                group.append(label, details);
            }
            results.append(group);
        }
        const actions = element('div', '', 'tle-actions');
        const inspect = button('查看酒馆实景', () => {
            if (!aiPreview) return setMessage('请先试套所选排版。');
            openComparison();
        }, 'menu_button tle-ai-inspect');
        actions.append(button('试套所选排版', () => {
            const fields = selection();
            if (!fields.length) return setMessage('请至少勾选一个可用的区域。');
            live = true;
            syncPreview();
            setMessage('正在试套。可查看酒馆实景或接受所选排版。');
        }), inspect, button('结束试套', () => {
            live = false;
            clearPreview();
            setMessage('已回到当前草稿。');
        }), button('接受并换素材', () => {
            const fields = selection();
            if (!fields.length) return setMessage('请至少勾选一个可用的区域。');
            aiPreview = undefined;
            draft.templates[draft.active] = applyLayout(current(), fields);
            page = 'materials';
            updateStatus();
            refreshPreview();
            renderBody();
            setMessage('排版已加入草稿，可以换素材或继续手调。');
        }));
        if (!results.childElementCount) results.append(element('p', '此设备暂无可套用的改动。'));
        results.prepend(scope, selectedCount, actions);
        syncPreview();
    }
    function checkSource(autoPreview) {
        const previousSource = session.source;
        session.source = source.value;
        try {
            if (previousSource !== session.source || !session.proposal.length) {
                session.proposal = readLayoutProposal(session.source, SECTIONS);
                session.excluded.clear();
            }
            review(autoPreview);
            if (!session.proposal.length) setMessage('没有找到范围内的排版参数。');
            else if (aiPreview) {
                source.blur();
                results.scrollIntoView({ block: 'nearest' });
                setMessage('已开始试套。可查看酒馆实景，也可逐项调整。');
            }
            else setMessage('可勾选区域和其中的单个参数。');
        } catch (error) {
            session.proposal = [];
            session.excluded.clear();
            review();
            setMessage(error.message);
        }
    }
    source.addEventListener('paste', event => {
        const value = event.clipboardData?.getData('text/plain');
        if (!value?.trim()) return;
        event.preventDefault();
        inputRevision++;
        source.value = value;
        checkSource(true);
    });
    const file = element('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.setAttribute('aria-label', 'AI 排版文件');
    file.addEventListener('change', async () => {
        const selected = file.files?.[0];
        file.value = '';
        if (!selected) return;
        if (selected.size > 64 * 1024) return setMessage('排版 JSON 文件超过 64 KB。');
        const revision = ++inputRevision;
        try {
            const value = await selected.text();
            if (!source.isConnected || inputRevision !== revision) return;
            source.value = value;
            checkSource(true);
        } catch {
            if (source.isConnected && inputRevision === revision) setMessage('无法读取排版文件。');
        }
    });
    const promptTools = element('details', '', 'tle-ui-disclosure tle-ai-prompt');
    promptTools.append(element('summary', '生成 AI 提示词'), goal, copy, prompt);
    promptTools.open = !session.source;
    const importTools = element('div', '', 'tle-actions');
    importTools.append(button('检查排版', () => checkSource(false)), button('选择排版 JSON', () => file.click()));
    const presets = element('div', '', 'tle-actions');
    presets.setAttribute('role', 'group');
    presets.setAttribute('aria-label', '内置排版起点');
    for (const { label, ...layout } of layoutStarts) {
        presets.append(button(label, () => {
            inputRevision++;
            const layers = devices.filter(key => layout[key]);
            session.scope = layers.length === 1 ? layers[0] : 'all';
            source.value = JSON.stringify({ format: layoutFormat, version: 1, ...layout }, null, 2);
            promptTools.open = false;
            checkSource(true);
        }));
    }
    card.append(element('h3', '导入 AI 排版'), element('small', '也可用内置排版直接试套'), presets,
        promptTools, source, file, importTools,
        results, locks, editorLink('返回界面外观', 'appearance'));
    body.append(card);
    if (session.proposal.length) review();
}

function rememberMaterial(url, label) {
    const name = recentMaterials.get(url) ?? label;
    recentMaterials.delete(url);
    recentMaterials.set(url, name);
    if (recentMaterials.size > 6) recentMaterials.delete(recentMaterials.keys().next().value);
    refreshMaterialShelf?.();
}

function renderMaterialShelf(read, apply, targetLabel) {
    const shelf = element('details', '', 'tle-ui-disclosure tle-material-shelf');
    const summary = element('summary');
    const list = element('div', '', 'tle-material-shelf-list');
    const favorites = element('details', '', 'tle-ui-disclosure tle-material-favorites');
    const favoritesSummary = element('summary');
    const favoriteList = element('div', '', 'tle-material-shelf-list');

    function saveFavorite(url, label) {
        if (!url || draft.materialFavorites.some(item => item.url === url)) return;
        if (draft.materialFavorites.length >= MAX_MATERIAL_FAVORITES) {
            setMessage('收藏已满 ' + MAX_MATERIAL_FAVORITES + ' 张。可以移除一张再添加。');
            return;
        }
        draft.materialFavorites.unshift({ url, label });
        refreshMaterialShelf();
        updateStatus();
        setMessage('已加入收藏。保存修改后可跨模板使用。');
    }

    function useImage(url, label, fromFavorites) {
        const image = element('img');
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.src = url;
        image.addEventListener('error', () => { image.hidden = true; });
        const control = button('', () => {
            apply(url);
            setMessage('已将素材应用到「' + targetLabel + '」。');
            body.querySelector('.tle-material-shelf').open = true;
            if (fromFavorites) body.querySelector('.tle-material-favorites').open = true;
        });
        const kind = url.startsWith('data:') ? '本地照片' : '链接图片';
        control.setAttribute('aria-label', (fromFavorites ? '应用收藏：' : '复用来自') + label + '的' + kind);
        control.append(image, element('span', label));
        return control;
    }

    const capture = button('收录当前图片', () => {
        const url = read();
        if (!url) return;
        rememberMaterial(url, targetLabel);
        setMessage('已收录，可在本次编辑中复用。');
    });
    const captureFavorite = button('收藏当前图片', () => saveFavorite(read(), targetLabel));
    favorites.append(favoritesSummary, captureFavorite, favoriteList);
    const batch = renderMaterialBatch();
    shelf.append(summary, favorites, capture, list, batch.node);
    refreshMaterialShelf = () => {
        batch.refreshSources();
        const currentUrl = read();
        const favorited = new Set(draft.materialFavorites.map(({ url }) => url));
        summary.textContent = '复用本次素材（' + recentMaterials.size + '）';
        favoritesSummary.textContent = '素材收藏（' + favorited.size + '）';
        capture.disabled = !currentUrl;
        captureFavorite.disabled = !currentUrl || favorited.has(currentUrl);
        favoriteList.replaceChildren();
        list.replaceChildren();
        if (!favorited.size) favoriteList.append(element('small', '收藏的图片可跨模板复用。'));
        if (!recentMaterials.size) list.append(element('small', '选择照片、填写链接或收录当前图片后可复用。'));
        for (const { url, label } of draft.materialFavorites) {
            const card = element('div', '', 'tle-material-shelf-card');
            const remove = button('移出收藏', () => {
                draft.materialFavorites = draft.materialFavorites.filter(item => item.url !== url);
                refreshMaterialShelf();
                updateStatus();
                setMessage('已移出收藏。已使用这张图片的位置仍保留原图。');
            });
            remove.setAttribute('aria-label', '移出收藏：' + label);
            card.append(useImage(url, label, true), remove);
            favoriteList.append(card);
        }
        for (const [url, label] of [...recentMaterials].reverse()) {
            const card = element('div', '', 'tle-material-shelf-card');
            const pin = button(favorited.has(url) ? '已收藏' : '收藏', () => saveFavorite(url, label));
            pin.setAttribute('aria-label', '收藏素材：' + label);
            pin.disabled = favorited.has(url);
            card.append(useImage(url, label, false), pin);
            list.append(card);
        }
    };
    refreshMaterialShelf();
    return shelf;
}

const commonMaterials = [
    ['page', '页面背景'], ['topPendant', '顶栏挂件'], ['chat', '聊天背景'],
    ['input', '输入栏背景'], ['sendButton', '发送图标'], ['wandButton', '魔杖图标'],
    ...Object.entries(MENUS).map(([id, menu]) => ['menus.' + id, menu.label + '背景']),
];

function renderMaterialBatch() {
    const node = element('details', '', 'tle-ui-disclosure tle-material-batch');
    const sourceList = element('select', '', 'text_pole');
    sourceList.setAttribute('aria-label', '批量素材来源');
    let sources = [];
    let source = '';
    function refreshSources() {
        const savedUrls = new Set(draft.materialFavorites.map(({ url }) => url));
        sources = [
            ...draft.materialFavorites.map(({ url, label }) => [url, '收藏 · ' + label]),
            ...[...recentMaterials].reverse().filter(([url]) => !savedUrls.has(url)),
        ];
        sourceList.replaceChildren(new Option('从收藏或本次素材选择', ''));
        for (const [index, [, label]] of sources.entries()) sourceList.add(new Option((index + 1) + ' · ' + label, String(index)));
        const index = sources.findIndex(([url]) => url === source);
        sourceList.value = index === -1 ? '' : String(index);
    }

    const urlInput = element('input', '', 'text_pole');
    urlInput.type = 'url';
    urlInput.placeholder = '或粘贴 HTTPS 图片链接';
    urlInput.setAttribute('aria-label', '批量素材图片 URL');
    urlInput.addEventListener('input', () => {
        source = '';
        sourceList.value = '';
    });
    sourceList.addEventListener('change', () => {
        source = sources[sourceList.value]?.[0] ?? '';
        urlInput.value = '';
        urlInput.placeholder = source ? '已选素材' : '或粘贴 HTTPS 图片链接';
    });
    const photos = createPhotoPicker({
        label: '批量素材', setMessage, urlInput,
        successMessage: '已选图片，请勾选要应用的位置。',
        onSelect(url) {
            source = url;
            rememberMaterial(url, '批量素材');
        },
    });
    const layerList = element('select', '', 'text_pole');
    layerList.setAttribute('aria-label', '批量挂图设备');
    layerList.add(new Option('只改当前设备', 'current'));
    layerList.add(new Option('桌面和手机都改', 'both'));
    const targets = element('div', '', 'tle-material-batch-targets');
    const checks = new Map();
    function addTarget(parent, key, label) {
        const row = element('label', '', 'tle-checkbox');
        const input = element('input');
        input.type = 'checkbox';
        row.append(input, label);
        parent.append(row);
        checks.set(key, input);
    }
    const edges = appearanceMap.filter(([, , slot]) => slot.startsWith('edge-'));
    for (const [key, label] of [...commonMaterials, ...edges]) addTarget(targets, key, label);
    const more = element('details', '', 'tle-ui-disclosure');
    more.append(element('summary', '其他素材位置'));
    const moreTargets = element('div', '', 'tle-material-batch-targets');
    for (const [key, descriptor] of Object.entries(SECTIONS)) {
        if (descriptor.fields.url && !checks.has(key)) addTarget(moreTargets, key, descriptor.label);
    }
    more.append(moreTargets);
    const shortcuts = element('div', '', 'tle-actions');
    shortcuts.append(
        button('勾选消息四边', () => {
            for (const [key] of edges) checks.get(key).checked = true;
        }),
        button('清除勾选', () => {
            for (const input of checks.values()) input.checked = false;
        }),
    );
    const apply = button('应用到所选位置', () => {
        const positions = [...checks].filter(([, input]) => input.checked).map(([key]) => key);
        if (!positions.length) return setMessage('请至少勾选一个素材位置。');
        const layers = layerList.value === 'both' ? devices : [device];
        const url = urlInput.value.trim() ? normalizeUrl(urlInput.value) : source;
        if (!url) return setMessage('请先选择照片或填写有效的 HTTPS 图片链接。');
        draft.templates[draft.active] = applyMaterialBatch(current(), url, positions, layers);
        for (const layer of layers) {
            for (const position of positions) invalidUrls.delete(position + '/' + layer);
        }
        rememberMaterial(url, '批量素材');
        updateStatus();
        refreshPreview();
        renderBody();
        body.querySelector('.tle-material-shelf').open = true;
        setMessage('已更新 ' + positions.length + ' 个位置。可一次撤销整批修改。');
    });
    node.append(element('summary', '批量换素材'), sourceList, urlInput, photos, layerList, shortcuts, targets, more, apply);
    return { node, refreshSources };
}

const materialStatusLabels = {
    set: '已设图片',
    inherited: '沿用上层图片',
    empty: '未设图片',
    hidden: '已隐藏图片',
    invalid: '链接待修正',
};

function materialStatus(template, key) {
    if (invalidUrls.has(key + '/' + device)) return 'invalid';
    let own;
    let effective;
    if (key.startsWith('menus.')) {
        const id = key.slice(6);
        own = template.menus?.[id]?.[device]?.panel?.background;
        effective = menuView(template.menus, id, device === 'mobile').panel.background;
    } else {
        own = template[device][key]?.url;
        effective = effectiveFields(template, device, key).url;
    }
    if (effective === '') return 'hidden';
    if (!effective) return 'empty';
    return own === undefined ? 'inherited' : 'set';
}

function renderMaterialIndex(options, choose) {
    const details = element('details', '', 'tle-ui-disclosure tle-material-index');
    details.open = materialIndex.open;
    const input = element('input', '', 'text_pole');
    input.type = 'search';
    input.setAttribute('aria-label', '搜索素材位置');
    input.placeholder = '例如：消息边框、挂件、魔杖';
    input.value = materialIndex.query;
    const filter = element('select', '', 'text_pole');
    filter.setAttribute('aria-label', '筛选素材状态');
    for (const [key, label] of [
        ['all', '全部状态'], ['withImage', '已有图片'], ['withoutImage', '没有图片'],
        ['inherited', '沿用上层图片'], ['invalid', '链接待修正'],
    ]) filter.add(new Option(label, key));
    filter.value = materialIndex.filter;
    const filters = element('div', '', 'tle-material-index-filters');
    filters.append(input, filter);
    const count = element('small');
    count.setAttribute('aria-live', 'polite');
    const results = element('div', '', 'tle-material-index-results');
    const aliases = new Map([...commonMaterials, ...appearanceMap.filter(([, , slot]) => slot.startsWith('edge-'))]);
    refreshMaterialIndex = () => {
        if (!details.open) return;
        const template = current();
        const words = materialIndex.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        results.replaceChildren();
        for (const { value: key, text: title, parentElement } of options) {
            const display = aliases.get(key) ?? title;
            const searchable = [title, display, parentElement.label, key,
                ...(key.startsWith('chatFrame') ? ['消息边框', '消息区四边'] : [])].join(' ').toLowerCase();
            if (!words.every(word => searchable.includes(word))) continue;
            const state = materialStatus(template, key);
            const filterKey = materialIndex.filter;
            if (filterKey === 'withImage' && !['set', 'inherited'].includes(state)) continue;
            if (filterKey === 'withoutImage' && !['empty', 'hidden'].includes(state)) continue;
            if (['inherited', 'invalid'].includes(filterKey) && filterKey !== state) continue;
            const result = button('', () => {
                materialIndex.open = false;
                choose(key);
            });
            result.setAttribute('aria-pressed', String(materialKey === key));
            result.append(element('span', display), element('small', materialStatusLabels[state], 'tle-material-state'));
            results.append(result);
        }
        count.textContent = results.childElementCount ? '匹配 ' + results.childElementCount + ' 个位置' : '没有匹配的素材位置';
    };
    input.addEventListener('input', () => {
        materialIndex.query = input.value;
        refreshMaterialIndex();
        results.scrollTop = 0;
    });
    filter.addEventListener('change', () => {
        materialIndex.filter = filter.value;
        refreshMaterialIndex();
        results.scrollTop = 0;
    });
    details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        materialIndex.open = details.open;
        refreshMaterialIndex();
    });
    details.append(element('summary', '素材清单与搜索'), filters, count, results);
    refreshMaterialIndex();
    return details;
}

function renderMaterials() {
    const card = element('section', '', 'tle-edit-card');
    if (!materialKey) materialKey = SECTIONS[section]?.fields.url ? section : 'page';
    const select = element('select', '', 'text_pole');
    select.setAttribute('aria-label', '素材位置');
    for (const [label, keys] of Object.values(zones)) {
        const group = element('optgroup');
        group.label = label;
        for (const key of keys) {
            if (SECTIONS[key].fields.url) group.append(new Option(SECTIONS[key].label, key));
        }
        if (group.childElementCount) select.append(group);
    }
    const menus = element('optgroup');
    menus.label = '菜单背景';
    for (const [id, menu] of Object.entries(MENUS)) menus.append(new Option(menu.label + '背景', 'menus.' + id));
    select.append(menus);
    select.value = materialKey;
    function choose(key) {
        materialKey = key;
        setMessage('');
        renderBody();
        const field = body.querySelector('#tle-field-url, .tle-menu-background input[type=url]');
        field?.scrollIntoView({ block: 'nearest' });
    }
    select.addEventListener('change', () => choose(select.value));
    const devicesRow = element('div', '', 'tle-segments');
    devicesRow.setAttribute('role', 'group');
    devicesRow.setAttribute('aria-label', '素材编辑设备');
    for (const [key, label] of [['desktop', '桌面设置'], ['mobile', '手机设置']]) {
        const control = button(label, () => { device = key; renderBody(); });
        control.setAttribute('aria-pressed', String(device === key));
        devicesRow.append(control);
    }
    const positions = element('div', '', 'tle-actions tle-material-positions');
    positions.setAttribute('role', 'group');
    positions.setAttribute('aria-label', '常用素材位置');
    for (const [key, label] of commonMaterials) {
        const control = button(label, () => choose(key));
        control.setAttribute('aria-pressed', String(materialKey === key));
        positions.append(control);
    }
    function openShelf(selector) {
        const shelf = body.querySelector('.tle-material-shelf');
        const disclosure = shelf.querySelector(selector);
        shelf.open = disclosure.open = true;
        const heading = disclosure.querySelector('summary');
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: 'start' });
    }
    const batch = button('直接批量换图', () => openShelf('.tle-material-batch'));
    const favoriteShortcut = button('打开素材收藏', () => openShelf('.tle-material-favorites'));
    const materialTools = element('div', '', 'tle-actions');
    materialTools.append(batch, favoriteShortcut);
    card.append(element('h3', '换素材'), devicesRow, positions, materialTools, select, renderMaterialIndex([...select.options], choose));
    body.append(card);
    if (materialKey.startsWith('menus.')) {
        const id = materialKey.slice(6);
        const label = MENUS[id].label + '背景';
        body.append(renderMaterialShelf(
            () => menuView(current().menus, id, device === 'mobile').panel.background,
            url => { menuEditor.setBackground(id, device, url); renderBody(); },
            label,
        ), menuEditor.renderBackground(id, device, renderBody, rememberMaterial));
    } else {
        section = materialKey;
        zone = Object.keys(zones).find(name => zones[name][1].includes(section)) ?? 'other';
        const descriptor = SECTIONS[section];
        body.append(renderMaterialShelf(
            () => effectiveFields(current(), device, section).url,
            url => {
                invalidUrls.delete(section + '/' + device);
                changeField('url', url);
                renderBody();
            },
            descriptor.label,
        ));
        renderAppearanceFields(descriptor, true);
        refreshThumbnail();
    }
    const shortcuts = element('div', '', 'tle-actions');
    shortcuts.append(editorLink('返回界面外观', 'appearance'), editorLink('导入 AI 排版', 'ai'));
    body.append(renderFrameBatch(), shortcuts);
}

function renderAppearanceNavigation() {
    const shortcuts = element('div', '', 'tle-actions');
    shortcuts.append(editorLink('导入 AI 排版', 'ai'), editorLink('换素材', 'materials'));
    body.append(shortcuts);
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
    tools.append(renderFrameBatch(), fallback, search);
    body.append(tools);
}

function openComparison() {
    panel.dataset.aiStage = 'true';
    const compare = panel.querySelector('.tle-ai-compare');
    compare.textContent = page === 'review' ? '看编辑前' : '看试套前';
    panel.querySelector('.tle-ai-return').textContent = page === 'review' ? '返回改动清单' : '返回排版检查';
    compare.focus();
}

const menuReviewLabels = {
    panel: '面板', entry: '入口', itemStyle: '统一项目样式',
    width: '宽度', height: '最大高度', columns: '列数', gap: '间距',
    background: '背景图片', fill: '底色', opacity: '不透明度', radius: '圆角',
    position: '打开位置', icon: '图标图片', color: '文字颜色', textSize: '字号',
};

function reviewFieldText(field, config, device) {
    function show(value) {
        if (value === undefined) return device === 'mobile' ? '继承' : '默认';
        if (config.type === 'url') return value ? (value.startsWith('data:') ? '本地照片' : '链接图片') : '已清空';
        return config.options?.[value] ?? (String(value) + (config.unit ?? ''));
    }
    const from = show(field.from);
    const to = show(field.to);
    return config.label + ' · ' + (config.type === 'url' && from === to ? '更换' + to : from + ' → ' + to);
}

function renderReview() {
    const selected = current();
    const changes = getLayoutReview(openingLayout, selected);
    const intro = element('section', '', 'tle-edit-card');
    const actions = element('div', '', 'tle-actions');
    actions.append(
        button('返回继续编辑', () => { page = reviewReturn; renderBody(); }),
        button('对照酒馆实景', openComparison, 'menu_button tle-review-inspect'),
    );
    intro.append(element('h3', '保存前核对'), element('small', '对照「' + openingLayout.name + '」与当前编辑的「' + selected.name + '」。'), actions);
    body.append(intro);
    let hasRecords = false;
    for (const layer of devices) {
        if (!changes[layer].length) continue;
        hasRecords = true;
        const group = element('section', '', 'tle-edit-card');
        group.append(element('h3', (layer === 'desktop' ? '桌面' : '手机') + ' · ' + changes[layer].length + ' 个区域'));
        for (const change of changes[layer]) {
            const descriptor = change.section ? SECTIONS[change.section] : undefined;
            const title = descriptor?.label ?? MENUS[change.menu]?.label ?? '全局菜单';
            const count = change.fields.length + (change.itemCount ?? 0);
            const detail = element('details', '', 'tle-ui-disclosure');
            detail.append(element('summary', title + '（' + count + ' 项）'));
            const list = element('ul', '', 'tle-review-list');
            for (const field of change.fields) {
                const config = descriptor?.fields[field.key] ?? {
                    label: menuReviewLabels[field.area] + ' · ' + menuReviewLabels[field.key],
                    type: ['background', 'icon'].includes(field.key) ? 'url' : 'text',
                    unit: ['width', 'height', 'gap', 'radius', 'textSize'].includes(field.key) ? ' px'
                        : field.key === 'opacity' ? '%' : '',
                };
                list.append(element('li', reviewFieldText(field, config, layer)));
            }
            if (change.itemCount) list.append(element('li', change.itemCount + ' 个菜单项目已改动'));
            detail.append(list);
            group.append(detail);
        }
        body.append(group);
    }
    const extra = element('ul', '', 'tle-review-list');
    for (const id of changes.sharedMenus) extra.append(element('li', MENUS[id].label + '分组已改动'));
    if (!equalSettings(openingLayout.layoutLocks, selected.layoutLocks)) extra.append(element('li', 'AI 尺寸锁定已改动'));
    for (const [id, savedTemplate] of Object.entries(saved.templates)) {
        const edited = draft.templates[id];
        if (!edited) extra.append(element('li', '删除模板「' + savedTemplate.name + '」'));
        else if (edited.name !== savedTemplate.name) extra.append(element('li', '模板改名为「' + edited.name + '」'));
        else if (id !== draft.active && !equalSettings(savedTemplate, edited)) extra.append(element('li', '更新其他模板「' + edited.name + '」'));
    }
    for (const [id, edited] of Object.entries(draft.templates)) {
        if (!Object.hasOwn(saved.templates, id)) extra.append(element('li', '新增模板「' + edited.name + '」'));
    }
    if (draft.active !== openingTemplateId) extra.append(element('li', '切换到模板「' + selected.name + '」'));
    if (!equalSettings(saved.materialFavorites, draft.materialFavorites)) {
        extra.append(element('li', '素材收藏已改动（' + saved.materialFavorites.length + ' → ' + draft.materialFavorites.length + ' 张）'));
    }
    if (saved.auto !== draft.auto || saved.manual !== draft.manual) extra.append(element('li', '场景自动换模板设置已改动'));
    if (extra.childElementCount) {
        hasRecords = true;
        const card = element('section', '', 'tle-edit-card');
        card.append(element('h3', '模板与通用设置'), extra);
        body.append(card);
    }
    if (invalidUrls.size) {
        hasRecords = true;
        const card = element('section', '', 'tle-edit-card');
        card.append(element('h3', '链接待修正'));
        for (const id of invalidUrls.keys()) {
            const [key, layer] = id.split('/');
            card.append(button((layer === 'mobile' ? '手机' : '桌面') + ' · ' + SECTIONS[key].label, () => {
                page = 'appearance';
                device = layer;
                chooseAppearance(key, 'url');
            }));
        }
        body.append(card);
    }
    if (!hasRecords) body.append(element('p', '当前没有待保存的改动。'));
}

function renderBody() {
    refreshMaterialShelf = undefined;
    refreshMaterialIndex = undefined;
    const wasComparing = panel.dataset.aiOriginal;
    delete panel.dataset.aiStage;
    delete panel.dataset.aiOriginal;
    if (aiPreview || wasComparing) {
        aiPreview = undefined;
        refreshPreview();
    }
    const tabPage = ['ai', 'materials'].includes(page) ? 'appearance' : page;
    for (const tab of panel.querySelectorAll('[data-section]')) tab.setAttribute('aria-pressed', String(tab.dataset.section === tabPage));
    body.replaceChildren();
    body.scrollTop = 0;
    if (page === 'review') return renderReview();
    if (page === 'ai') return renderAiLayout();
    if (page === 'materials') return renderMaterials();
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
    if (section !== 'scene' && section !== 'mobileComposer') body.append(renderDeviceTransfer());
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
    renderAppearanceFields(descriptor);
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
    chooseAppearance(key);
    setMessage('已选中「' + SECTIONS[key].label + '」。');
}

function closeEditor() {
    setPicking(false);
    editorViewport?.abort();
    editorViewport = undefined;
    panel?.remove();
    panel = body = status = message = draft = history = undefined;
    invalidUrls.clear();
    importedParts = undefined;
    aiPreview = undefined;
    openingLayout = openingTemplateId = undefined;
    aiGoal = '';
    aiSessions.clear();
    materialKey = '';
    recentMaterials.clear();
    refreshMaterialShelf = undefined;
    refreshMaterialIndex = undefined;
    Object.assign(materialIndex, { query: '', filter: 'all', open: false });
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
    openingTemplateId = draft.active;
    openingLayout = savedLayout();
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
            if (aiPreview) return setMessage('请先接受所选排版或结束试套。');
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
    panel.addEventListener('focusout', event => {
        if (history?.field === event.target) history.field = null;
    });
    panel.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && !event.target.matches('input,textarea,[contenteditable]')) {
            const key = event.key.toLowerCase();
            if (key === 'z' || key === 'y') {
                event.preventDefault();
                stepHistory(key === 'y' || event.shiftKey ? 1 : -1);
                return;
            }
        }
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (panel.dataset.aiStage) panel.querySelector('.tle-ai-return').click();
            else if (picking) setPicking(false);
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
    const shortcuts = element('div', '', 'tle-ui-shortcuts');
    const historyControls = element('div', '', 'tle-history-controls');
    const undo = button('撤销', () => stepHistory(-1));
    const redo = button('重做', () => stepHistory(1));
    history = { entries: [draftSnapshot()], index: 0, field: null, undo, redo };
    historyControls.append(undo, redo, button('查看改动', () => {
        if (page !== 'review') reviewReturn = page;
        page = 'review';
        setMessage('');
        renderBody();
        body.querySelector('.tle-review-inspect')?.focus({ preventScroll: true });
    }));
    const compare = button('看试套前', () => {
        if (panel.dataset.aiOriginal) delete panel.dataset.aiOriginal;
        else panel.dataset.aiOriginal = 'true';
        syncComparison();
        refreshPreview();
    }, 'menu_button tle-ai-compare');
    function syncComparison() {
        compare.textContent = page === 'review'
            ? (panel.dataset.aiOriginal ? '看当前草稿' : '看编辑前')
            : (panel.dataset.aiOriginal ? '看试套后' : '看试套前');
    }
    const aiReturn = button('返回排版检查', () => {
        delete panel.dataset.aiStage;
        if (panel.dataset.aiOriginal) {
            delete panel.dataset.aiOriginal;
            refreshPreview();
        }
        syncComparison();
        body.querySelector('.tle-ai-inspect, .tle-review-inspect')?.focus({ preventScroll: true });
    }, 'menu_button tle-ai-return');
    shortcuts.append(pickButton, historyControls, compare, aiReturn);
    header.append(titleRow, tabs, shortcuts);
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
