import { applyLayout, devices, layoutChanges, layoutFields, layoutPrompt, layoutStarts, layoutFormat, layoutValue, lockId, readLayoutProposal } from './ai-layout.mjs';
import { checkpointSettings, isTemplateId, readTemplates, restoreCheckpointSettings, templateLimit } from './draft-checkpoint.mjs';
import { cleanQuickAccess, searchWorkbench, WORKBENCH_ACTIONS } from './workbench.mjs';
import { clearPositionClipboard, createPositionPad, focusPositionPad, refreshPositionPads } from './image-position.mjs';
import { createPhotoPicker, IMAGE_SIZE_OPTIONS, MAX_TEMPLATE_FILE } from './image-assets.mjs';
import * as hostApp from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { getThemeObject, power_user } from '/scripts/power-user.js';
import { download } from '/scripts/utils.js';
import { getContext } from '/scripts/st-context.js';
import { createRuntime } from './runtime.js';
import { createMenuRuntime } from './menu-runtime.js';
import { createMenuEditor } from './menu-editor.js';
import { MENUS, MENU_STYLE_FIELDS, menuView } from './menus.mjs';
import { createCustomization } from './customization.js';
import { BREAKPOINT, GROUPS, MAX_MATERIAL_FAVORITES, SECTIONS, applyMaterialBatch, applyTemplateParts, blankTemplate, cleanField, cleanMaterialFavorites, cleanName, compileCss, effectiveFields, equalSettings, findMaterialUses, getLayoutReview, getShareSummary, groupMaterialUses, matchScene, materialImage, mergeTheme, normalizeUrl, parseTemplate, replaceMaterialUses, restoreReviewFields } from './model.mjs';

const KEY = 'tavern_layout_editor';
const TITLE = '纯白';
const { eventSource, event_types, saveSettings } = hostApp;
const isTauriTavern = () => Boolean(window.__TAURITAVERN__ || window.__TAURITAVERN_MAIN_READY__);
const LIMIT = templateLimit;
const menuId = 'tle-menu';
const templateId = () => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(18)), byte => byte.toString(16).padStart(2, '0'));
    return hex.join('');
};

let saved;
let savedRevision = '';
let parkedDraft;
let resumedParkedId;
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
let workbenchReturn = 'menus';
let workbenchQuery = '';
let organizeQuickAccess = false;
const openReviewAreas = new Set();
const reviewSelection = new Set();
let reviewSelectionOwner;
let reviewFilter = 'all';
let reviewBatch = false;
let themeFlow;
let refreshFlowMaterials;
let refreshShareStatus;
const themeSteps = [['ai', '选排版'], ['materials', '换素材'], ['review', '核对保存']];
let aiGoal = '';
const aiSessions = new Map();
let materialKey = '';
const recentMaterials = new Map();
let refreshMaterialShelf;
let refreshMaterialIndex;
let refreshMaterialReplacement;
const materialIndex = { query: '', filter: 'all', imageFilter: 'all', mode: 'positions', open: false };
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

function loadEditorSettings() {
    const input = extension_settings[KEY];
    const templates = readTemplates(input?.templates);
    let active = Object.hasOwn(templates, input?.active) ? input.active : Object.keys(templates)[0];
    if (!active) {
        active = templateId();
        templates[active] = blankTemplate();
    }
    saved = {
        active, templates, materialFavorites: cleanMaterialFavorites(input?.materialFavorites),
        quickAccess: cleanQuickAccess(input?.quickAccess, SECTIONS), ...sceneSettings(input),
    };
    savedRevision = isTemplateId(input?.revision) ? input.revision : '';
    const checkpoint = input?.parkedDraft;
    parkedDraft = checkpoint?.version === 1 && isTemplateId(checkpoint.id) && isTemplateId(checkpoint.active) &&
        Object.hasOwn(checkpoint.layouts ?? {}, checkpoint.active) ? checkpoint : undefined;
}

async function persistEditorSettings(settings, revision, checkpoint) {
    const old = extension_settings[KEY];
    const next = { ...settings, revision, ...(checkpoint ? { parkedDraft: checkpoint } : {}) };
    const origin = panel;
    let acknowledged = false;
    const accept = () => { acknowledged = true; };
    applying = true;
    origin.inert = true;
    eventSource.on(event_types.SETTINGS_UPDATED, accept);
    extension_settings[KEY] = next;
    try {
        const result = await saveSettings();
        if (result !== true && (result === false || !acknowledged)) throw new Error('宿主尚未确认保存，请重试。');
        return true;
    } catch (error) {
        if (extension_settings[KEY] === next) extension_settings[KEY] = old;
        if (panel === origin) setMessage(error.message || '保存失败，请重试。');
        return false;
    } finally {
        eventSource.removeListener(event_types.SETTINGS_UPDATED, accept);
        origin.inert = false;
        applying = false;
    }
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
    layoutLock: layoutLockButton, retryImage: retryPreviewImage,
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
    const dirty = invalidUrls.size || !equalSettings(comparable, draft);
    status.textContent = current().name + (dirty ? ' · 未保存' : ' · 已保存') +
        (draft.auto && !draft.manual && draft.active === sceneActive ? ' · 场景自动切换' : '');
    status.dataset.dirty = dirty ? 'true' : 'false';
    refreshMaterialIndex?.();
    refreshMaterialReplacement?.();
    refreshFlowMaterials?.();
    refreshShareStatus?.();
    refreshPositionPads(body);
}

function setMessage(text) {
    if (message) message.textContent = text;
}

function photoPending() {
    return Boolean(body?.querySelector('[data-tle-photo-pending]'));
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
            refreshMaterialIndex?.();
            refreshFlowMaterials?.();
        };
        image.onload = () => complete('loaded');
        image.onerror = () => complete('failed');
        image.src = url;
    }
    return images.get(url).status;
}

function retryPreviewImage(url) {
    if (!url) return;
    images.delete(url);
    refreshPreview();
    refreshThumbnail();
    refreshPositionPads(body, url);
}

function refreshPreview() {
    if (!saved) return;
    const comparison = panel?.dataset.aiOriginal ? (page === 'review' ? reviewBaseline() : current()) : undefined;
    const template = structuredClone(comparison ?? aiPreview ?? current());
    const activeUrls = new Set();
    function prepareImage(fields, field) {
        const url = fields?.[field];
        if (!url) return;
        activeUrls.add(url);
        if (imageState(url) !== 'loaded') fields[field] = '';
    }
    for (const layout of [template.desktop, template.mobile]) {
        for (const fields of Object.values(layout)) prepareImage(fields, 'url');
    }
    for (const menu of Object.values(template.menus ?? {})) {
        for (const device of devices) prepareImage(menu[device]?.panel, 'background');
    }
    customization.update(template);
    nativeMenus.update(template.menus);
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
    const retry = feedback.nextElementSibling;
    if (retry?.classList.contains('tle-image-retry')) retry.hidden = result !== 'failed';
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

function renderField(key, field, rerender = renderBody) {
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
            rerender();
        }));
        if (own === '' && device === 'mobile') row.append(element('small', '移动端图片已清空'));
    }
    if (field.type !== 'select') {
        row.append(button(device === 'mobile' ? '继承' : '默认', () => {
            if (field.type === 'url') invalidUrls.delete(urlKey);
            changeField(key, undefined);
            rerender();
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

function addTemplate(template, beforeSelect) {
    if (Object.keys(draft.templates).length >= LIMIT) throw new Error('最多保存 ' + LIMIT + ' 个模板');
    const id = templateId();
    draft.templates[id] = template;
    beforeSelect?.(id);
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
    }), button('导入模板', () => file.click()), themeFlowButton());
    templateCard.append(element('h3', '当前模板'), select, toolbar);
    body.append(file, templateCard, renderSharing(), management, renderPartialApply());
}

function renderSharing() {
    const sharing = element('section', '', 'tle-share-card');
    const source = element('small');
    refreshShareStatus = () => {
        const edited = invalidUrls.size || !equalSettings(current(), saved.templates[draft.active]);
        source.textContent = edited ? '导出当前草稿，可继续编辑或另行保存。' : '导出当前已保存模板。';
    };
    refreshShareStatus();
    const template = current();
    const { runtimeFeatures, hasLocalPhotos } = getShareSummary(template);

    const themeName = element('input', '', 'text_pole');
    themeName.type = 'text';
    themeName.maxLength = 80;
    themeName.placeholder = '原生主题名称（选填）';
    themeName.setAttribute('aria-label', '原生主题名称');
    const shareOption = (title, description, action) => {
        const choice = button('', () => {
            if (photoPending()) return setMessage('正在处理照片，请稍候。');
            if (invalidUrls.size) return setMessage('请先修正或清空无效图片 URL。');
            action();
        }, 'tle-share-option');
        choice.setAttribute('aria-label', title);
        const caption = element('span');
        caption.append(element('strong', title), element('small', description));
        const arrow = element('span', '↓', 'tle-share-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        choice.append(caption, arrow);
        return choice;
    };

    const complete = shareOption('完整模板（含排序和分组）', '接收方在纯白的「我的模板 → 导入模板」打开。', () => {
        jsonDownload(parseTemplate(current()), current().name);
        setMessage('已导出完整模板。');
    });
    const native = shareOption('酒馆主题（静态外观）', '接收方在酒馆的「用户设置 → UI 主题」导入后选中。', () => {
        const title = cleanName(themeName.value) || cleanName(power_user.theme + ' · ' + current().name);
        jsonDownload(mergeTheme(getThemeObject(title), current()), title);
        setMessage('已导出酒馆主题。');
    });
    const compat = element('details', '', 'tle-ui-disclosure');
    const headline = runtimeFeatures.length
        ? runtimeFeatures.length + ' 类效果需要纯白'
        : '导出格式与导入说明';
    compat.append(element('summary', headline));
    if (runtimeFeatures.length) {
        compat.append(element('small', '以下效果需使用完整模板，并由接收方的纯白提供。'));
        const list = element('ul', '', 'tle-share-compat');
        for (const note of runtimeFeatures) list.append(element('li', note));
        compat.append(list);
    } else {
        compat.append(element('small', '完整模板支持继续编辑。酒馆主题适合直接应用静态外观。'));
    }
    compat.append(themeName);
    sharing.append(element('h3', '分享'), source, complete, native, compat);
    if (hasLocalPhotos) sharing.append(element('small', '导出会携带该格式所使用的本地照片，请确认这些图片适合分享。'));
    return sharing;
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

function renderAppearanceFields(descriptor, materials = false, container = body, rerender = renderBody) {
    const all = Object.entries(descriptor.fields);
    const preferred = quickFields[section] ??
        (descriptor.group === 'buttons' ? ['url', 'icon', 'color', 'fontSize'] :
            ['url', 'sizePx', 'repeat', 'fill', 'radius', 'width', 'color']);
    const materialKeys = ['url', 'icon', 'size', 'position', 'imageOpacity', 'mask', 'sizePx', 'height', 'align', 'repeat'];
    const fineKeys = ['imageX', 'imageY', 'imageScale', 'offsetX', 'offsetY'];
    const ordered = (materials ? materialKeys : preferred).filter(key => Object.hasOwn(descriptor.fields, key)).slice(0, materials ? materialKeys.length : 4);
    const quick = new Set(ordered.length ? ordered : all.slice(0, 3).map(([key]) => key));
    const card = element('section', '', 'tle-edit-card tle-quick-appearance');
    const heading = element('h3', descriptor.label);
    heading.tabIndex = -1;
    card.append(heading);
    const details = element('details', '', 'tle-ui-disclosure');
    details.append(element('summary', '全部设置'));
    const add = (parent, key, field) => {
        parent.append(renderField(key, field, rerender));
        if (key === 'url') {
            const thumb = element('img', '', 'tle-thumbnail');
            thumb.alt = '背景图片预览';
            thumb.referrerPolicy = 'no-referrer';
            const feedback = element('small', '', 'tle-image-status');
            feedback.setAttribute('role', 'status');
            const retry = button('重试加载图片', () => retryPreviewImage(effectiveFields(current(), device, section).url),
                'menu_button tle-image-retry');
            retry.hidden = true;
            parent.append(thumb, feedback, retry);
        }
    };
    for (const key of quick) add(card, key, descriptor.fields[key]);
    const fine = element('details', '', 'tle-ui-disclosure');
    fine.append(element('summary', '精调图片'));
    for (const key of fineKeys) if (descriptor.fields[key]) add(fine, key, descriptor.fields[key]);
    if (fine.childElementCount > 1) {
        if (descriptor.fields.imageScale) {
            const read = () => effectiveFields(current(), device, section);
            const selector = ({ top: '#top-bar', chat: '#chat', input: '#send_form', page: '#bg1' })[section] || descriptor.selector;
            function applyPicture(values, pasted) {
                const scroll = body.scrollTop;
                const fields = current()[device][section] ??= {};
                Object.assign(fields, values);
                if (Object.hasOwn(values, 'url')) invalidUrls.delete(section + '/' + device);
                refreshPreview();
                updateStatus();
                rerender();
                focusPositionPad(body, scroll, pasted);
            }
            const fallbackSize = descriptor.kind === 'art' && section !== 'cover' ? 'contain' : 'cover';
            const label = descriptor.label + (device === 'mobile' ? ' · 手机' : ' · 桌面');
            const pad = createPositionPad({ read, apply: applyPicture, button, label, selector, fallbackSize });
            fine.querySelector('summary').after(pad);
            const preset = button('在此设备使用图片预设', () => applyPicture({ imageX: -1, imageY: -1, imageScale: 0 }));
            fine.classList.add('tle-picture-tuning');
            fine.append(element('small', '水平 0% 为左，垂直 0% 为上。定位填 -1 或缩放填 0 时沿用该设备的预设。'), preset);
        }
        card.append(fine);
    }
    for (const [key, field] of all) if (!quick.has(key) && !fineKeys.includes(key)) add(details, key, field);
    if (details.childElementCount > 1) card.append(details);
    container.append(card);
}

function editorLink(label, target) {
    return button(label, () => {
        page = target;
        setMessage('');
        renderBody();
    });
}

function activeThemeFlow() {
    return themeFlow?.id === draft?.active ? themeFlow : undefined;
}

function openThemeStep(step) {
    if (step === 'review' && page !== 'review') reviewReturn = page;
    page = step;
    setMessage('');
    renderBody();
    body.querySelector('.tle-theme-steps [aria-current="step"]')?.focus({ preventScroll: true });
}

function availableCopyName(name, label) {
    const names = new Set(Object.values(draft.templates).map(({ name }) => name));
    const makeName = suffix => name.slice(0, 80 - suffix.length) + suffix;
    let result = makeName(' · ' + label);
    for (let number = 2; names.has(result); number++) result = makeName(' · ' + label + ' ' + number);
    return result;
}

function themeFlowButton() {
    return button(activeThemeFlow() ? '继续制作主题' : '做一套主题', startThemeFlow);
}

function startThemeFlow() {
    const active = activeThemeFlow();
    if (active) {
        openThemeStep(active.step);
        return;
    }
    if (invalidUrls.size) return setMessage('请先修正或清空待修正的图片链接。');
    const original = current();
    const name = availableCopyName(original.name, '副本');
    try {
        const source = structuredClone(original);
        addTemplate({ ...structuredClone(source), name }, id => {
            themeFlow = { id, source, step: 'ai', material: '', fullMaterials: false };
            page = 'ai';
        });
        body.querySelector('.tle-theme-steps [aria-current="step"]')?.focus({ preventScroll: true });
        setMessage('已从原模板建立副本草稿。');
    } catch (error) {
        setMessage(error.message);
    }
}

function renderThemeSteps(flow) {
    flow.step = page;
    const bar = element('section', '', 'tle-edit-card tle-theme-flow');
    const list = element('nav', '', 'tle-segments tle-theme-steps');
    list.setAttribute('aria-label', '主题制作步骤');
    for (const [index, [key, label]] of themeSteps.entries()) {
        const control = button((index + 1) + ' ' + label, () => { if (page !== key) openThemeStep(key); });
        if (page === key) control.setAttribute('aria-current', 'step');
        list.append(control);
    }
    bar.append(element('h3', '做一套主题'), list);
    body.append(bar);
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
const materialAliases = new Map([...commonMaterials, ...appearanceMap.filter(([, , slot]) => slot.startsWith('edge-'))]);
const materialName = key => materialAliases.get(key) ?? SECTIONS[key].label;

function renderMaterialSource(label, successMessage) {
    const sourceList = element('select', '', 'text_pole');
    sourceList.setAttribute('aria-label', label + '来源');
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
    urlInput.setAttribute('aria-label', label + '图片 URL');
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
        label, setMessage, urlInput, successMessage,
        onSelect(url) {
            source = url;
            rememberMaterial(url, label);
            refreshSources();
        },
    });
    return {
        controls: [sourceList, urlInput, photos],
        refreshSources,
        read: () => urlInput.value.trim() ? normalizeUrl(urlInput.value) : source,
    };
}

function renderMaterialBatch() {
    const node = element('details', '', 'tle-ui-disclosure tle-material-batch');
    const asset = renderMaterialSource('批量素材', '已选图片，请勾选要应用的位置。');
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
        const url = asset.read();
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
    node.append(element('summary', '批量换素材'), ...asset.controls, layerList, shortcuts, targets, more, apply);
    return { node, refreshSources: asset.refreshSources };
}

function renderMaterialReplacement(read, rerender) {
    const node = element('details', '', 'tle-ui-disclosure tle-material-replacement');
    const summary = element('summary');
    const asset = renderMaterialSource('替换素材', '已选新图，点「替换所选位置」预览。');
    const shortcuts = element('div', '', 'tle-actions');
    const targets = element('div', '', 'tle-material-batch-targets');
    const count = element('small');
    count.setAttribute('role', 'status');
    let original;
    let template;
    let choices = [];
    const selected = () => choices.filter(({ input }) => input.checked);
    const apply = button('替换所选位置', () => {
        if (photoPending()) return setMessage('正在处理照片，请稍候。');
        const url = asset.read();
        if (!url) return setMessage('请先选择照片或填写有效的 HTTPS 图片链接。');
        if (url === original) return setMessage('请选择一张不同的图片。');
        const matches = selected();
        const previous = current();
        const next = replaceMaterialUses(previous, original, url, matches);
        if (next === previous) return setMessage('请勾选要替换的位置。');
        draft.templates[draft.active] = next;
        for (const { key, device } of matches) invalidUrls.delete(key + '/' + device);
        rememberMaterial(url, '替换素材');
        refreshPreview();
        updateStatus();
        rerender(true);
        const control = body.querySelector('.tle-material-replacement:not([hidden]) > summary') ??
            body.querySelector('#tle-field-url, .tle-menu-background input[type=url]');
        control?.focus({ preventScroll: true });
        control?.scrollIntoView({ block: 'nearest' });
        setMessage('已换图 ' + matches.length + ' 处。可一次撤销。');
    });
    function updateCount() {
        const total = selected().length;
        count.textContent = '已选 ' + total + ' 处';
        apply.disabled = total === 0;
    }
    for (const [layer, label] of [['desktop', '仅勾选桌面'], ['mobile', '仅勾选手机'], ['', '勾选全部']]) {
        shortcuts.append(button(label, () => {
            for (const choice of choices) choice.input.checked = !layer || choice.device === layer;
            updateCount();
        }));
    }
    refreshMaterialReplacement = () => {
        const source = read();
        if (source === original && template === current()) return;
        original = source;
        template = current();
        const uses = findMaterialUses(template, original);
        node.hidden = uses.length < 2;
        node.open = false;
        summary.textContent = '替换同图（' + uses.length + ' 处）';
        targets.replaceChildren();
        choices = uses.map(use => {
            const { device, key, inherited } = use;
            const input = element('input');
            input.type = 'checkbox';
            input.checked = true;
            input.addEventListener('change', updateCount);
            const row = element('label', '', 'tle-checkbox');
            const name = materialName(key);
            const title = (device === 'mobile' ? '手机' : '桌面') + ' · ' + name;
            row.append(input, title + (inherited ? '（沿用上层）' : ''));
            targets.append(row);
            return { ...use, input };
        });
        updateCount();
    };
    node.addEventListener('toggle', () => {
        if (node.open) asset.refreshSources();
    });
    node.append(summary, shortcuts, targets, count, ...asset.controls, apply);
    refreshMaterialReplacement();
    return node;
}

const materialStatusLabels = {
    set: '已设图片',
    inherited: '沿用上层图片',
    empty: '未设图片',
    hidden: '已隐藏图片',
    invalid: '链接待修正',
    failed: '图片加载失败',
};

function materialStatus(template, key, { own, effective } = materialImage(template, key, device)) {
    if (invalidUrls.has(key + '/' + device)) return 'invalid';
    if (effective === '') return 'hidden';
    if (!effective) return 'empty';
    if (images.get(effective)?.status === 'failed') return 'failed';
    return own === undefined ? 'inherited' : 'set';
}

function materialPreview(url) {
    const preview = element('span', '', 'tle-theme-material-preview');
    preview.setAttribute('aria-hidden', 'true');
    if (images.get(url)?.status !== 'loaded') return preview;
    const photo = element('img');
    photo.alt = '';
    photo.referrerPolicy = 'no-referrer';
    photo.loading = 'lazy';
    photo.src = url;
    preview.append(photo);
    return preview;
}

function linkedImageName(url) {
    const link = new URL(url);
    const file = link.pathname.split('/').filter(Boolean).at(-1);
    let title = file ?? link.hostname;
    try { title = decodeURIComponent(title); } catch { /* Keep undecodable URL escapes visible. */ }
    return { title, hostname: link.hostname };
}

function renderImageInventory(results, favorites, choose, matches, usageDetails) {
    const open = new Set([...usageDetails].filter(([, detail]) => detail.open).map(([url]) => url));
    usageDetails.clear();
    const nodes = [];
    for (const [url, uses] of groupMaterialUses(current())) {
        const first = uses.find(use => use.device === device) ?? uses[0];
        const local = url.startsWith('data:');
        const { title: filename, hostname } = local
            ? { title: materialName(first.key), hostname: '本地照片' } : linkedImageName(url);
        const title = favorites.get(url) ?? filename;
        const status = images.get(url)?.status;
        if (materialIndex.imageFilter === 'failed' && status !== 'failed') continue;
        const placements = uses.map(use => [
            use.device === 'mobile' ? '手机' : '桌面', materialName(use.key),
            use.key.startsWith('chatFrame') ? '消息边框 消息区四边' : '',
        ].join(' '));
        if (!matches([title, filename, hostname, ...placements].join(' '))) continue;

        const card = element('article', '', 'tle-material-image-card');
        const header = element('div', '', 'tle-material-image-header');
        const text = element('div');
        const desktop = uses.filter(use => use.device === 'desktop').length;
        const sizes = ['桌面 ' + desktop + ' 处', '手机 ' + (uses.length - desktop) + ' 处'];
        text.append(element('strong', title), element('small', sizes.join(' · ')), element('small', hostname));
        if (status === 'failed') text.append(element('small', '图片加载失败', 'tle-material-state'));
        else if (status === 'loading') text.append(element('small', '正在加载', 'tle-material-state'));

        const replace = button('替换', () => choose(first.key, first.device, uses.length > 1));
        replace.setAttribute('aria-label', '替换图片 · ' + title);
        header.append(materialPreview(url), text, replace);
        const detail = element('details', '', 'tle-material-image-uses');
        detail.open = open.has(url);
        detail.append(element('summary', '查看用图位置'));
        const links = element('div', '', 'tle-actions');
        for (const use of uses) {
            const label = (use.device === 'mobile' ? '手机' : '桌面') + ' · ' + materialName(use.key);
            links.append(button(label, () => choose(use.key, use.device)));
        }
        detail.append(links);
        usageDetails.set(url, detail);
        card.append(header, detail);
        nodes.push(card);
    }
    results.replaceChildren(...nodes);
}

function renderMaterialIndex(options, choose) {
    const details = element('details', '', 'tle-ui-disclosure tle-material-index');
    details.open = materialIndex.open;
    const input = element('input', '', 'text_pole');
    input.type = 'search';
    input.value = materialIndex.query;
    const filter = element('select', '', 'text_pole');
    filter.setAttribute('aria-label', '筛选素材状态');
    const positionFilters = [
        ['all', '全部状态'], ['withImage', '已有图片'], ['withoutImage', '没有图片'],
        ['inherited', '沿用上层图片'], ['invalid', '链接待修正'], ['failed', '图片加载失败'],
    ];
    const imageFilters = [['all', '全部图片'], ['failed', '图片加载失败']];
    const modes = element('div', '', 'tle-segments');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', '素材清单视图');
    const byPosition = button('按位置', () => switchMode('positions'));
    const byImage = button('按图片', () => switchMode('images'));
    modes.append(byPosition, byImage);
    const filters = element('div', '', 'tle-material-index-filters');
    filters.append(input, filter);
    const count = element('small');
    count.setAttribute('aria-live', 'polite');
    const results = element('div', '', 'tle-material-index-results');
    const usageDetails = new Map();
    function setModeControls() {
        const byAsset = materialIndex.mode === 'images';
        byPosition.setAttribute('aria-pressed', String(!byAsset));
        byImage.setAttribute('aria-pressed', String(byAsset));
        input.setAttribute('aria-label', byAsset ? '搜索已用图片' : '搜索素材位置');
        input.placeholder = byAsset ? '搜索文件名、域名或位置' : '例如：消息边框、挂件、魔杖';
        filter.replaceChildren(...(byAsset ? imageFilters : positionFilters).map(([value, label]) => new Option(label, value)));
        filter.value = byAsset ? materialIndex.imageFilter : materialIndex.filter;
    }
    function switchMode(mode) {
        materialIndex.mode = mode;
        setModeControls();
        refreshMaterialIndex();
        results.scrollTop = 0;
    }
    refreshMaterialIndex = () => {
        if (!details.open) return;
        const words = materialIndex.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const matches = searchable => {
            const text = searchable.toLowerCase();
            return words.every(word => text.includes(word));
        };
        const scroll = results.scrollTop;
        const byAsset = materialIndex.mode === 'images';
        if (byAsset) {
            const favorites = new Map(draft.materialFavorites.map(({ url, label }) => [url, label]));
            renderImageInventory(results, favorites, choose, matches, usageDetails);
        } else renderPositionResults(matches);
        const total = results.childElementCount;
        count.textContent = total ? '匹配 ' + total + (byAsset ? ' 张图片' : ' 个位置') :
            (byAsset ? '没有匹配的已用图片' : '没有匹配的素材位置');
        results.scrollTop = scroll;
    };
    function renderPositionResults(matches) {
        const template = current();
        const buttons = [];
        for (const { value: key, text: title, parentElement } of options) {
            const display = materialName(key);
            const searchable = [title, display, parentElement.label, key,
                ...(key.startsWith('chatFrame') ? ['消息边框', '消息区四边'] : [])].join(' ');
            if (!matches(searchable)) continue;
            const image = materialImage(template, key, device);
            const state = materialStatus(template, key, image);
            const filterKey = materialIndex.filter;
            if (filterKey === 'withImage' && !['set', 'inherited'].includes(state)) continue;
            if (filterKey === 'withoutImage' && !['empty', 'hidden'].includes(state)) continue;
            if (['inherited', 'invalid', 'failed'].includes(filterKey) && filterKey !== state) continue;
            const result = button('', () => {
                materialIndex.open = false;
                choose(key);
            });
            result.setAttribute('aria-pressed', String(materialKey === key));
            result.classList.add('tle-material-position-result');
            result.append(materialPreview(image.effective), element('span', display), element('small', materialStatusLabels[state], 'tle-material-state'));
            buttons.push(result);
        }
        results.replaceChildren(...buttons);
    }
    input.addEventListener('input', () => {
        materialIndex.query = input.value;
        refreshMaterialIndex();
        results.scrollTop = 0;
    });
    filter.addEventListener('change', () => {
        if (materialIndex.mode === 'images') materialIndex.imageFilter = filter.value;
        else materialIndex.filter = filter.value;
        refreshMaterialIndex();
        results.scrollTop = 0;
    });
    details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        materialIndex.open = details.open;
        refreshMaterialIndex();
    });
    details.append(element('summary', '素材清单与搜索'), modes, filters, count, results);
    setModeControls();
    refreshMaterialIndex();
    return {
        node: details,
        openImages() {
            materialIndex.open = details.open = true;
            switchMode('images');
            byImage.focus({ preventScroll: true });
            details.scrollIntoView({ block: 'nearest' });
        },
    };
}

function materialDevices() {
    const row = element('div', '', 'tle-segments');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '素材编辑设备');
    for (const [key, label] of [['desktop', '桌面设置'], ['mobile', '手机设置']]) {
        const control = button(label, () => {
            device = key;
            renderBody();
            body.querySelector('.tle-segments[aria-label="素材编辑设备"] [aria-pressed="true"]')?.focus({ preventScroll: true });
        });
        control.setAttribute('aria-pressed', String(device === key));
        row.append(control);
    }
    return row;
}

function renderMaterialEditor(key, container, inline = false) {
    function rerender(preserveScroll = false) {
        const scroll = body.scrollTop;
        renderBody();
        if (inline || preserveScroll) body.scrollTop = scroll;
    }
    const read = () => materialImage(current(), key, device).effective;
    const replacement = renderMaterialReplacement(read, rerender);
    if (key.startsWith('menus.')) {
        const id = key.slice(6);
        const shelf = renderMaterialShelf(read, url => {
            menuEditor.setBackground(id, device, url);
            rerender();
        }, MENUS[id].label + '背景');
        const controls = menuEditor.renderBackground(id, device, rerender, rememberMaterial);
        container.append(...(inline ? [controls, replacement, shelf] : [shelf, replacement, controls]));
        return;
    }
    section = key;
    zone = Object.keys(zones).find(name => zones[name][1].includes(key)) ?? 'other';
    const descriptor = SECTIONS[key];
    const shelf = renderMaterialShelf(read, url => {
        invalidUrls.delete(key + '/' + device);
        changeField('url', url);
        rerender();
    }, descriptor.label);
    if (!inline) container.append(shelf, replacement);
    renderAppearanceFields(descriptor, true, container, rerender);
    if (inline) container.append(replacement, shelf);
}

function renderThemeMaterials(flow) {
    const positions = [
        ...commonMaterials.slice(0, 4),
        ...appearanceMap.filter(([, , slot]) => slot.startsWith('edge-')).map(([key, label]) => [key, label]),
        ...commonMaterials.slice(4),
    ];
    const heading = element('section', '', 'tle-edit-card');
    const links = element('div', '', 'tle-actions');
    links.append(button('打开完整素材设置', () => {
        flow.fullMaterials = true;
        if (flow.material) materialKey = flow.material;
        renderBody();
    }), button('下一步 · 核对保存', () => openThemeStep('review')));
    heading.append(element('h3', '按位置换图'), materialDevices(), links);
    body.append(heading);
    const list = element('div', '', 'tle-theme-materials');
    body.append(list);
    const entries = [];
    for (const [key, label] of positions) {
        const row = element('section', '', 'tle-theme-material');
        row.dataset.materialLocation = key;
        const photo = element('img');
        photo.alt = '';
        photo.loading = 'lazy';
        photo.referrerPolicy = 'no-referrer';
        photo.addEventListener('error', () => { photo.hidden = true; });
        const thumbnail = element('span', '', 'tle-theme-material-preview');
        thumbnail.append(photo);
        const title = element('div');
        const state = element('small');
        title.append(element('strong', label), state);
        const expanded = flow.material === key;
        const controls = button(expanded ? '收起' : '换图', () => {
            const scroll = body.scrollTop;
            flow.material = expanded ? '' : key;
            renderBody();
            body.scrollTop = scroll;
            const updated = [...body.querySelectorAll('[data-material-location]')].find(item => item.dataset.materialLocation === key);
            if (!updated) return;
            updated.querySelector('.tle-theme-material-open')?.focus({ preventScroll: true });
            updated.querySelector('.tle-theme-material-header')?.scrollIntoView({ block: 'nearest' });
        }, 'menu_button tle-theme-material-open');
        controls.setAttribute('aria-label', (expanded ? '收起' : '换图') + ' · ' + label);
        controls.setAttribute('aria-expanded', String(expanded));
        const line = element('div', '', 'tle-theme-material-header');
        line.append(thumbnail, title, controls);
        row.append(line);
        list.append(row);
        entries.push({ key, photo, state });
        if (expanded) renderMaterialEditor(key, row, true);
    }
    refreshFlowMaterials = () => {
        const template = current();
        for (const { key, photo, state } of entries) {
            const image = materialImage(template, key, device);
            if (image.effective) {
                if (photo.getAttribute('src') !== image.effective) {
                    photo.hidden = false;
                    photo.src = image.effective;
                }
            } else {
                photo.hidden = true;
                photo.removeAttribute('src');
            }
            state.textContent = materialStatusLabels[materialStatus(template, key, image)];
        }
    };
    refreshFlowMaterials();
    refreshThumbnail();
}

function openMaterialShelf(selector) {
    const shelf = body.querySelector('.tle-material-shelf');
    const disclosure = shelf.querySelector(selector);
    shelf.open = disclosure.open = true;
    const heading = disclosure.querySelector('summary');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start' });
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
    function choose(key, layer = device, replace = false) {
        materialKey = key;
        device = layer;
        setMessage('');
        renderBody();
        if (replace) {
            const details = body.querySelector('.tle-material-replacement:not([hidden])');
            if (details) {
                details.open = true;
                const summary = details.querySelector('summary');
                summary.focus({ preventScroll: true });
                summary.scrollIntoView({ block: 'nearest' });
                return;
            }
        }
        const field = body.querySelector('#tle-field-url, .tle-menu-background input[type=url]');
        field?.scrollIntoView({ block: 'nearest' });
    }
    select.addEventListener('change', () => choose(select.value));
    const positions = element('div', '', 'tle-actions tle-material-positions');
    positions.setAttribute('role', 'group');
    positions.setAttribute('aria-label', '常用素材位置');
    for (const [key, label] of commonMaterials) {
        const control = button(label, () => choose(key));
        control.setAttribute('aria-pressed', String(materialKey === key));
        positions.append(control);
    }
    const batch = button('直接批量换图', () => openMaterialShelf('.tle-material-batch'));
    const favoriteShortcut = button('打开素材收藏', () => openMaterialShelf('.tle-material-favorites'));
    const index = renderMaterialIndex([...select.options], choose);
    const materialTools = element('div', '', 'tle-actions');
    materialTools.append(button('查看已用图片', index.openImages), batch, favoriteShortcut);
    const flow = activeThemeFlow();
    if (flow) materialTools.append(button('返回换图清单', () => {
        flow.fullMaterials = false;
        renderBody();
    }));
    card.append(element('h3', '换素材'), materialDevices(), positions, materialTools, select, index.node);
    body.append(card);
    renderMaterialEditor(materialKey, body);
    refreshThumbnail();
    const shortcuts = element('div', '', 'tle-actions');
    shortcuts.append(editorLink('返回界面外观', 'appearance'), editorLink('导入 AI 排版', 'ai'));
    body.append(renderFrameBatch(), shortcuts);
}

function renderAppearanceNavigation() {
    const shortcuts = element('div', '', 'tle-actions');
    shortcuts.append(themeFlowButton(), editorLink('导入 AI 排版', 'ai'), editorLink('换素材', 'materials'));
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
    size: '图片缩放', imageX: '图片水平位置', imageY: '图片垂直位置', imageScale: '图片自定缩放',
    order: '顺序', group: '分组', pinned: '置顶', label: '显示名称',
};

function reviewFieldText(field, config, device) {
    function show(value) {
        if (value === undefined) return device === 'mobile' ? '继承' : '默认';
        if (config.type === 'url') return value ? (value.startsWith('data:') ? '本地照片' : '链接图片') : '已清空';
        if (typeof value === 'boolean') return value ? '是' : '否';
        return config.options?.[value] ?? (String(value) + (config.unit ?? ''));
    }
    const from = show(field.from);
    const to = show(field.to);
    return config.label + ' · ' + (config.type === 'url' && from === to ? '更换' + to : from + ' → ' + to);
}

function reviewBaseline() {
    return activeThemeFlow()?.source ?? openingLayout;
}

function reviewFieldConfig(change, field, baseline, selected, item) {
    if (change.section) return SECTIONS[change.section].fields[field.key];
    const label = menuReviewLabels[field.key];
    return {
        label: item ? label : menuReviewLabels[field.area] + ' · ' + label,
        type: ['background', 'icon'].includes(field.key) ? 'url' : 'text',
        unit: ['width', 'height', 'gap', 'radius', 'textSize'].includes(field.key) ? ' px' : ['opacity', 'imageX', 'imageY', 'imageScale'].includes(field.key) ? '%' : '',
        options: field.key === 'group' ? {
            ...baseline.menus?.[change.menu]?.groups, ...selected.menus?.[change.menu]?.groups,
            '': '不分组', more: '更多',
        } : field.key === 'size' ? IMAGE_SIZE_OPTIONS : undefined,
    };
}

function jumpToReviewField(layer, change, field, item) {
    if (change.section) {
        page = 'appearance';
        device = layer;
        chooseAppearance(change.section, field.key);
        return;
    }
    page = 'menus';
    const id = change.menu === 'global' ? 'wand' : change.menu;
    const scope = item ? 'item' : change.menu === 'global' ? 'global' : field.area;
    menuEditor.select({ id, scope, key: item }, layer === 'mobile');
    pickedMenu = Boolean(item);
    setMessage('');
    renderBody();
    const fieldSelector = '[data-menu-field="' + field.key + '"]';
    const row = item ? [...body.querySelectorAll('[data-menu-row]')].find(node => node.dataset.menuRow === item) : undefined;
    const control = item
        ? row?.querySelector('button' + fieldSelector + ', ' + fieldSelector + ' :is(input, select, button)') ?? row?.querySelector('.tle-item-open')
        : body.querySelector('[data-menu-area="' + field.area + '"]' + fieldSelector + ' :is(input, select)');
    const disclosure = control?.closest('details');
    if (disclosure) disclosure.open = true;
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ block: 'center' });
    if (!control && item) setMessage('该菜单项当前不可用。');
}

function restoreFromReview(updates, areaId) {
    try {
        draft.templates[draft.active] = restoreReviewFields(current(), reviewBaseline(), updates);
    } catch (error) {
        setMessage(error.message);
        return;
    }
    for (const { id, layer, change, field } of updates) {
        reviewSelection.delete(id);
        if (change.section && field.key === 'url') invalidUrls.delete(change.section + '/' + layer);
    }
    redrawReview(areaId);
    refreshPreview();
    updateStatus();
    setMessage(updates.length === 1 ? '已恢复这一项。可以撤销。' : '已恢复 ' + updates.length + ' 项。可以一次撤销。');
}

function redrawReview(areaId) {
    const scroll = body.scrollTop;
    for (const area of body.querySelectorAll('details[data-review-area]')) {
        if (area.open) openReviewAreas.add(area.dataset.reviewArea);
        else openReviewAreas.delete(area.dataset.reviewArea);
    }
    renderBody();
    body.scrollTop = scroll;
    if (areaId) {
        const detail = [...body.querySelectorAll('[data-review-area]')].find(node => node.dataset.reviewArea === areaId);
        (detail?.querySelector('summary') ?? body.querySelector('.tle-review-inspect'))?.focus({ preventScroll: true });
    }
}

function reviewFieldRow(update, baseline, selected, areaId, checks) {
    const { id, layer, change, field, item } = update;
    const config = reviewFieldConfig(change, field, baseline, selected, item);
    const row = element('li', '', 'tle-review-field');
    const controls = element('div', '', 'tle-actions');
    const jump = button('定位控件', () => jumpToReviewField(layer, change, field, item));
    jump.setAttribute('aria-label', '定位控件 · ' + config.label);
    const caption = reviewFieldText(field, config, layer);
    if (checks) {
        const label = element('label', '', 'tle-checkbox');
        const check = element('input');
        check.type = 'checkbox';
        check.checked = reviewSelection.has(id);
        check.setAttribute('aria-label', '勾选恢复 · ' + config.label);
        label.append(check, caption);
        checks.push({ check, update });
        row.append(label);
    } else {
        const restore = button('恢复此项', () => restoreFromReview([update], areaId));
        restore.setAttribute('aria-label', '恢复此项 · ' + config.label);
        row.append(element('span', caption));
        controls.append(restore);
    }
    controls.prepend(jump);
    row.append(controls);
    return row;
}

function renderReviewControls(hasFieldChanges) {
    const card = element('section', '', 'tle-edit-card');
    const filters = element('div', '', 'tle-segments');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', '筛选改动设备');
    for (const [key, label] of [['all', '全部改动'], ['desktop', '只看桌面'], ['mobile', '只看手机']]) {
        const control = button(label, () => {
            reviewFilter = key;
            redrawReview();
            body.querySelector('.tle-review-filter [aria-pressed="true"]')?.focus({ preventScroll: true });
        });
        control.setAttribute('aria-pressed', String(reviewFilter === key));
        filters.append(control);
    }
    filters.classList.add('tle-review-filter');
    const toggle = button(reviewBatch ? '结束多选' : '多选恢复', () => {
        reviewBatch = !reviewBatch;
        if (!reviewBatch) reviewSelection.clear();
        redrawReview();
        body.querySelector('.tle-review-batch-toggle')?.focus({ preventScroll: true });
    }, 'menu_button tle-review-batch-toggle');
    toggle.setAttribute('aria-pressed', String(reviewBatch));
    card.append(filters);
    if (hasFieldChanges) card.append(toggle);
    return card;
}

function renderReview() {
    const selected = current();
    const baseline = reviewBaseline();
    const flow = activeThemeFlow();
    const changes = getLayoutReview(baseline, selected);
    if (reviewSelectionOwner !== draft.active) {
        reviewSelectionOwner = draft.active;
        reviewSelection.clear();
    }
    const intro = element('section', '', 'tle-edit-card');
    const actions = element('div', '', 'tle-actions');
    actions.append(
        button('返回继续编辑', () => { page = reviewReturn; renderBody(); }),
        button('对照酒馆实景', openComparison, 'menu_button tle-review-inspect'),
    );
    intro.append(element('h3', '保存前核对'));
    if (flow) {
        const label = element('label', '新主题名称');
        const name = element('input', '', 'text_pole');
        name.type = 'text';
        name.maxLength = 80;
        name.value = selected.name;
        name.addEventListener('input', () => {
            const value = cleanName(name.value);
            if (!value) return;
            selected.name = value;
            updateStatus();
        });
        name.addEventListener('blur', () => { name.value = selected.name; });
        label.append(name);
        intro.append(label);
    }
    intro.append(element('small', '对照「' + baseline.name + '」与当前草稿。'), actions);
    const share = element('details', '', 'tle-ui-disclosure tle-review-sharing');
    share.append(element('summary', '分享当前主题'), renderSharing());
    body.append(intro, share);
    const hasFieldChanges = devices.some(layer => changes[layer].length);
    if (hasFieldChanges || invalidUrls.size || reviewFilter !== 'all') body.append(renderReviewControls(hasFieldChanges));
    const visibleChecks = [];
    const bulk = element('div', '', 'tle-actions tle-review-batch');
    const counter = element('small');
    counter.setAttribute('aria-live', 'polite');
    const selectedUpdates = () => visibleChecks.filter(({ check }) => check.checked).map(({ update }) => update);
    const clear = button('清空本范围勾选', () => {
        for (const { check, update } of visibleChecks) {
            check.checked = false;
            reviewSelection.delete(update.id);
        }
        syncBulkControls();
    });
    const apply = button('恢复所选改动', () => {
        const updates = selectedUpdates();
        if (updates.length) restoreFromReview(updates, updates[0].areaId);
    }, 'menu_button tle-primary');
    const syncAreas = [];
    function syncBulkControls() {
        const count = selectedUpdates().length;
        counter.textContent = '本范围已选 ' + count + ' 项';
        clear.disabled = apply.disabled = count === 0;
        for (const sync of syncAreas) sync();
    }
    bulk.append(counter, clear, apply);
    if (reviewBatch && hasFieldChanges) body.append(bulk);

    let hasRecords = false;
    for (const layer of devices) {
        if ((reviewFilter !== 'all' && reviewFilter !== layer) || !changes[layer].length) continue;
        hasRecords = true;
        const group = element('section', '', 'tle-edit-card');
        group.append(element('h3', (layer === 'desktop' ? '桌面' : '手机') + ' · ' + changes[layer].length + ' 个区域'));
        for (const change of changes[layer]) {
            const descriptor = change.section ? SECTIONS[change.section] : undefined;
            const title = descriptor?.label ?? MENUS[change.menu]?.label ?? '全局菜单';
            const count = change.fields.length + (change.items?.length ?? 0);
            const areaId = layer + '/' + (change.section ?? 'menus.' + change.menu);
            const detail = element('details', '', 'tle-ui-disclosure');
            detail.dataset.reviewArea = areaId;
            detail.open = openReviewAreas.has(areaId);
            detail.addEventListener('toggle', () => {
                if (!detail.isConnected) return;
                if (detail.open) openReviewAreas.add(areaId);
                else openReviewAreas.delete(areaId);
            });
            detail.append(element('summary', title + '（' + count + ' 项）'));
            const areaChecks = reviewBatch ? [] : undefined;
            function appendFields(fields, item) {
                const list = element('ul', '', 'tle-review-list');
                for (const field of fields) {
                    const id = JSON.stringify([areaId, item, field.area, field.key]);
                    const update = { id, layer, change, field, item, areaId };
                    list.append(reviewFieldRow(update, baseline, selected, areaId, areaChecks));
                }
                detail.append(list);
            }
            if (change.fields.length) appendFields(change.fields);
            if (change.items?.length) {
                const names = new Map(nativeMenus.items(change.menu).map(item => [item.key, item.label]));
                const view = menuView(selected.menus, change.menu, layer === 'mobile');
                for (const { key, fields } of change.items) {
                    const name = view.items[key]?.label || names.get(key) || key;
                    detail.append(element('h4', name));
                    appendFields(fields, key);
                }
            }
            if (areaChecks?.length) {
                visibleChecks.push(...areaChecks);
                const label = element('label', '', 'tle-checkbox');
                const pickAll = element('input');
                pickAll.type = 'checkbox';
                label.append(pickAll, '勾选本区域');
                detail.querySelector('summary').after(label);
                syncAreas.push(() => {
                    const count = areaChecks.filter(({ check }) => check.checked).length;
                    pickAll.checked = count === areaChecks.length;
                    pickAll.indeterminate = count > 0 && count < areaChecks.length;
                });
                function setChecked(check, update, checked) {
                    check.checked = checked;
                    if (checked) reviewSelection.add(update.id);
                    else reviewSelection.delete(update.id);
                }
                pickAll.addEventListener('change', () => {
                    for (const { check, update } of areaChecks) setChecked(check, update, pickAll.checked);
                    syncBulkControls();
                });
                for (const { check, update } of areaChecks) {
                    check.addEventListener('change', () => {
                        setChecked(check, update, check.checked);
                        syncBulkControls();
                    });
                }
            }
            group.append(detail);
        }
        body.append(group);
    }
    syncBulkControls();
    const extra = element('ul', '', 'tle-review-list');
    for (const id of changes.sharedMenus) extra.append(element('li', MENUS[id].label + '分组已改动'));
    if (!equalSettings(baseline.layoutLocks, selected.layoutLocks)) extra.append(element('li', 'AI 尺寸锁定已改动'));
    for (const [id, savedTemplate] of Object.entries(saved.templates)) {
        const edited = draft.templates[id];
        if (!edited) extra.append(element('li', '删除模板「' + savedTemplate.name + '」'));
        else if (edited.name !== savedTemplate.name) extra.append(element('li', '模板改名为「' + edited.name + '」'));
        else if (id !== draft.active && !equalSettings(savedTemplate, edited)) extra.append(element('li', '更新其他模板「' + edited.name + '」'));
    }
    for (const [id, edited] of Object.entries(draft.templates)) {
        if (!Object.hasOwn(saved.templates, id)) {
            extra.append(element('li', flow?.id === id ? '新增当前主题副本' : '新增模板「' + edited.name + '」'));
        }
    }
    if (draft.active !== openingTemplateId && !flow) extra.append(element('li', '切换到模板「' + selected.name + '」'));
    if (!equalSettings(saved.materialFavorites, draft.materialFavorites)) {
        extra.append(element('li', '素材收藏已改动（' + saved.materialFavorites.length + ' → ' + draft.materialFavorites.length + ' 张）'));
    }
    if (!equalSettings(saved.quickAccess, draft.quickAccess)) extra.append(element('li', '我的常用已改动'));
    if (saved.auto !== draft.auto || saved.manual !== draft.manual) extra.append(element('li', '场景自动换模板设置已改动'));
    if (reviewFilter === 'all' && extra.childElementCount) {
        hasRecords = true;
        const card = element('section', '', 'tle-edit-card');
        card.append(element('h3', '模板与通用设置'), extra);
        body.append(card);
    }
    const invalidEntries = [...invalidUrls.keys()].filter(id => reviewFilter === 'all' || id.endsWith('/' + reviewFilter));
    if (invalidEntries.length) {
        hasRecords = true;
        const card = element('section', '', 'tle-edit-card');
        card.append(element('h3', '链接待修正'));
        for (const id of invalidEntries) {
            const [key, layer] = id.split('/');
            card.append(button((layer === 'mobile' ? '手机' : '桌面') + ' · ' + SECTIONS[key].label, () => {
                page = 'appearance';
                device = layer;
                chooseAppearance(key, 'url');
            }));
        }
        body.append(card);
    }
    if (!hasRecords) body.append(element('p', reviewFilter === 'all'
        ? '当前没有待保存的改动。' : '此设备没有待保存的改动。'));
}

function checkpointWorkspace() {
    const flow = activeThemeFlow();
    const session = aiSessions.get(draft.active);
    const plan = { format: layoutFormat, version: 1, desktop: {}, mobile: {} };
    for (const field of session?.proposal ?? []) {
        (plan[field.device][field.area] ??= {})[field.key] = field.value;
    }
    return {
        page: page === 'workbench' ? workbenchReturn : page, device, section, zone, materialKey, reviewReturn,
        menu: menuEditor.position(),
        invalid: [...invalidUrls],
        flow,
        ai: session ? { source: session.source.slice(0, 64 * 1024), scope: session.scope, excluded: [...session.excluded], plan } : undefined,
        aiGoal,
    };
}

async function parkCurrentDraft() {
    if (applying) return;
    if (photoPending()) return setMessage('正在处理照片，请稍候。');
    if (status.dataset.dirty !== 'true' && !aiSessions.get(draft.active)?.source.trim() && !aiGoal.trim()) {
        return setMessage('当前没有需要暂存的修改。');
    }
    if (parkedDraft && resumedParkedId !== parkedDraft.id &&
        !window.confirm('已有暂存草稿。要用本次修改替换它吗？')) return;
    const checkpoint = structuredClone({
        version: 1, id: templateId(), revision: savedRevision,
        ...checkpointSettings(saved, draft),
        workspace: checkpointWorkspace(),
    });
    setMessage('正在暂存草稿…');
    if (await persistEditorSettings(saved, savedRevision, checkpoint)) {
        parkedDraft = checkpoint;
        if (panel) closeEditor();
    }
}

const editorPages = ['menus', 'appearance', 'templates', 'ai', 'materials', 'review'];
const isMaterialPosition = key => typeof key === 'string' &&
    (Object.hasOwn(SECTIONS, key) && Boolean(SECTIONS[key].fields.url) ||
     key.startsWith('menus.') && Object.hasOwn(MENUS, key.slice(6)));

function resumeWorkspace(workspace) {
    page = editorPages.includes(workspace?.page) ? workspace.page : 'templates';
    device = devices.includes(workspace?.device) ? workspace.device : device;
    if (Object.hasOwn(SECTIONS, workspace?.section)) {
        section = workspace.section;
        zone = workspace.zone ? Object.keys(zones).find(key => zones[key][1].includes(section)) ?? 'other' : '';
    }
    materialKey = isMaterialPosition(workspace?.materialKey) ? workspace.materialKey : '';
    reviewReturn = editorPages.includes(workspace?.reviewReturn) && workspace.reviewReturn !== 'review' ? workspace.reviewReturn : 'materials';
    invalidUrls.clear();
    for (const entry of Array.isArray(workspace?.invalid) ? workspace.invalid : []) {
        if (!Array.isArray(entry)) continue;
        const [key, text] = entry;
        if (typeof key !== 'string' || typeof text !== 'string') continue;
        const [position, layer] = key.split('/');
        if (key === position + '/' + layer && Object.hasOwn(SECTIONS, position) && SECTIONS[position].fields.url &&
            devices.includes(layer)) invalidUrls.set(key, text.slice(0, 2048));
    }
    menuEditor.restorePosition(workspace?.menu);
    themeFlow = undefined;
    const flow = workspace?.flow;
    if (flow && themeSteps.some(([step]) => step === flow.step)) {
        try {
            themeFlow = {
                id: draft.active, source: parseTemplate(flow.source), step: flow.step,
                material: isMaterialPosition(flow.material) ? flow.material : '', fullMaterials: flow.fullMaterials === true,
            };
        } catch {
            themeFlow = undefined;
        }
    }
    aiGoal = typeof workspace?.aiGoal === 'string' ? workspace.aiGoal.slice(0, 2000) : '';
    const ai = workspace?.ai;
    if (ai && typeof ai.source === 'string' && ai.source.length <= 64 * 1024) {
        let proposal = [];
        try {
            proposal = readLayoutProposal(JSON.stringify(ai.plan), SECTIONS);
        } catch {
            // The text remains available for another check.
        }
        const ids = new Set(proposal.map(field => lockId(field.device, field)));
        aiSessions.set(draft.active, {
            source: ai.source, proposal,
            scope: devices.includes(ai.scope) ? ai.scope : 'all',
            excluded: new Set(Array.isArray(ai.excluded) ? ai.excluded.filter(id => ids.has(id)) : []),
        });
    }
}

function resumeParkedDraft() {
    if (status.dataset.dirty === 'true' || aiSessions.get(draft.active)?.source.trim() || aiGoal.trim()) {
        return setMessage('当前还有未保存修改。保存或取消后，可继续暂存草稿。');
    }
    try {
        if (parkedDraft.revision !== savedRevision) {
            const source = parseTemplate(parkedDraft.layouts[parkedDraft.active]);
            addTemplate({ ...source, name: availableCopyName(source.name, '暂存副本') }, () => { page = 'templates'; });
            setMessage('当前模板已更新，暂存的主题已作为副本打开。');
            return;
        }
        draft = {
            ...restoreCheckpointSettings(saved, parkedDraft),
            materialFavorites: cleanMaterialFavorites(parkedDraft.materialFavorites),
            quickAccess: cleanQuickAccess(parkedDraft.quickAccess ?? saved.quickAccess, SECTIONS), ...sceneSettings(parkedDraft),
        };
    } catch (error) {
        setMessage(error.message);
        return;
    }
    resumedParkedId = parkedDraft.id;
    resumeWorkspace(parkedDraft.workspace);
    renderBody();
    refreshPreview();
    updateStatus();
    setMessage('已恢复暂存草稿。');
}

function renderParkedDraft() {
    if (!parkedDraft || resumedParkedId === parkedDraft.id) return;
    const card = element('section', '', 'tle-edit-card');
    const name = cleanName(parkedDraft.layouts[parkedDraft.active]?.name) || '上次主题';
    const stale = parkedDraft.revision !== savedRevision;
    const actions = element('div', '', 'tle-actions');
    actions.append(
        button(stale ? '另存暂存主题为副本' : '继续上次草稿', resumeParkedDraft),
        button('删除暂存', async () => {
            if (applying || !window.confirm('删除这份暂存草稿？')) return;
            if (await persistEditorSettings(saved, savedRevision, undefined)) {
                parkedDraft = undefined;
                if (panel) {
                    renderBody();
                    setMessage('暂存草稿已删除。');
                }
            }
        }),
    );
    card.append(element('h3', '有一份暂存草稿'), element('small', name), actions);
    if (stale) card.append(element('small', '正式设置已变化。可将暂存的当前主题另存为副本。'));
    return card;
}

function toggleWorkbench() {
    if (photoPending()) return setMessage('正在处理照片，请稍候。');
    if (page === 'workbench') {
        page = workbenchReturn;
        renderBody();
        panel.querySelector('.tle-workbench-launch')?.focus({ preventScroll: true });
        return;
    }
    workbenchReturn = page;
    page = 'workbench';
    setMessage('');
    renderBody();
    const focusTarget = matchMedia('(pointer: coarse)').matches
        ? body.querySelector('.tle-workbench-title') : body.querySelector('.tle-workbench-query');
    focusTarget?.focus({ preventScroll: true });
}

function openWorkbenchEntry(id) {
    const [kind, target, area, field] = id.split('/');
    if (kind === 'appearance') {
        page = 'appearance';
        chooseAppearance(target, area);
        return;
    }
    if (kind === 'menu' || kind === 'item') {
        jumpToReviewField(device, { menu: target }, { area, key: field }, kind === 'item' ? area : undefined);
        return;
    }
    if (target === 'create') {
        startThemeFlow();
        return;
    }
    if (target === 'batch' || target === 'favorites') {
        const flow = activeThemeFlow();
        if (flow) flow.fullMaterials = true;
        page = 'materials';
        renderBody();
        openMaterialShelf(target === 'batch' ? '.tle-material-batch' : '.tle-material-favorites');
        return;
    }
    if (target === 'review' && workbenchReturn !== 'review') reviewReturn = workbenchReturn;
    page = target;
    setMessage('');
    renderBody();
}

function workbenchEntries() {
    const entries = [];
    for (const [key, [title, keywords]] of Object.entries(WORKBENCH_ACTIONS)) {
        entries.push({ id: 'action/' + key, title, context: '常用操作', keywords });
    }
    for (const [section, descriptor] of Object.entries(SECTIONS)) {
        for (const [key, config] of Object.entries(descriptor.fields)) {
            const words = [GROUPS[descriptor.group], config.unit];
            if (section.startsWith('chatFrame')) words.push('消息边框 聊天四边');
            if (descriptor.kind === 'message') words.push('气泡 对话气泡');
            if (section === 'topPendant' && key.startsWith('offset')) words.push('挂件偏移 挂件移动');
            const legacyMenu = section === 'optionsMenu' || section === 'wandMenu';
            const context = descriptor.label + (legacyMenu ? ' · 旧版外观' : '');
            const keywords = words.filter(Boolean).join(' ');
            entries.push({ id: 'appearance/' + section + '/' + key, title: config.label, context, keywords, legacy: legacyMenu });
        }
    }
    for (const [menu, name] of [...Object.entries(MENUS).map(([id, { label }]) => [id, label]), ['global', '全局菜单']]) {
        for (const [area, keys] of Object.entries(MENU_STYLE_FIELDS)) {
            for (const key of keys) {
                entries.push({
                    id: ['menu', menu, area, key].join('/'),
                    title: menuReviewLabels[key],
                    context: name + ' · ' + menuReviewLabels[area],
                });
            }
        }
        if (menu === 'global') continue;
        const aliases = {
            'id:attachFile': '附件 上传文件', 'id:manageAttachments': '数据银行 资料库 附件管理',
            'id:show_gallery_wand_button': '相册 图库', 'id:option_toggle_AN': '作者注释 作者备注',
        };
        const view = menuView(current().menus, menu, device === 'mobile');
        for (const item of nativeMenus.items(menu)) {
            const display = view.items[item.key]?.label;
            entries.push({
                id: ['item', menu, item.key].join('/'),
                title: display || item.label,
                context: name + ' · 菜单项目',
                keywords: [item.label, item.key, aliases[item.key], '改名 排序 置顶 图标 分组'].filter(Boolean).join(' '),
            });
        }
    }
    return entries;
}

function renderWorkbench() {
    const card = element('section', '', 'tle-edit-card');
    const search = element('input', '', 'text_pole tle-workbench-query');
    search.type = 'search';
    search.value = workbenchQuery;
    search.placeholder = '例如：气泡 圆角、挂件偏移、魔杖菜单 背景';
    search.setAttribute('aria-label', '搜索设置和操作');
    const devicesRow = element('div', '', 'tle-segments');
    devicesRow.setAttribute('role', 'group');
    devicesRow.setAttribute('aria-label', '快速定位设备');
    for (const [key, name] of [['desktop', '桌面'], ['mobile', '手机']]) {
        const control = button(name, () => {
            device = key;
            renderBody();
            body.querySelector('[aria-label="快速定位设备"] [aria-pressed="true"]')?.focus({ preventScroll: true });
        });
        control.setAttribute('aria-pressed', String(device === key));
        devicesRow.append(control);
    }
    const title = element('h3', '快速定位', 'tle-workbench-title');
    title.tabIndex = -1;
    card.append(title, search, devicesRow);
    const favorites = element('section', '', 'tle-edit-card');
    const pinned = element('div', '', 'tle-workbench-list');
    const pinnedHeading = element('h3', '我的常用');
    const organize = button(organizeQuickAccess ? '完成整理' : '整理常用', () => {
        organizeQuickAccess = !organizeQuickAccess;
        organize.textContent = organizeQuickAccess ? '完成整理' : '整理常用';
        renderLists();
    });
    favorites.append(pinnedHeading, organize, pinned);
    organize.classList.add('tle-workbench-organize');
    const matches = element('section', '', 'tle-edit-card');
    const heading = element('h3');
    const status = element('small');
    status.setAttribute('aria-live', 'polite');
    const results = element('div', '', 'tle-workbench-list tle-workbench-results');
    matches.append(heading, status, results);
    body.append(card, favorites, matches);

    function renderEntry(entry, list, position) {
        const label = entry.context + ' · ' + entry.title;
        const row = element('div', '', 'tle-quick-row');
        const title = button('', () => openWorkbenchEntry(entry.id), 'menu_button tle-quick-open');
        title.setAttribute('aria-label', label);
        title.disabled = entry.unavailable === true;
        title.append(element('strong', entry.title), element('small', entry.context));
        const present = draft.quickAccess.includes(entry.id);
        const pin = button(present ? '移出常用' : '加入常用', () => {
            draft.quickAccess = present ? draft.quickAccess.filter(id => id !== entry.id) : [...draft.quickAccess, entry.id];
            updateStatus();
            renderLists();
            const equivalent = [...list.querySelectorAll('button[data-quick-pin]')].find(node => node.dataset.quickPin === entry.id);
            (equivalent ?? (list === pinned ? organize : search)).focus({ preventScroll: true });
        });
        pin.setAttribute('aria-label', (present ? '移出常用' : '加入常用') + ' · ' + label);
        pin.dataset.quickPin = entry.id;
        row.append(title, pin);
        if (organizeQuickAccess && position !== undefined) {
            const order = element('div', '', 'tle-actions');
            for (const [delta, text] of [[-1, '上移'], [1, '下移']]) {
                const destination = position + delta;
                const move = button(text, () => {
                    [draft.quickAccess[position], draft.quickAccess[destination]] =
                        [draft.quickAccess[destination], draft.quickAccess[position]];
                    updateStatus();
                    renderLists();
                    [...pinned.querySelectorAll('button')].find(control =>
                        control.getAttribute('aria-label') === text + ' · ' + label && !control.disabled)?.focus({ preventScroll: true });
                });
                move.setAttribute('aria-label', text + ' · ' + label);
                move.disabled = destination < 0 || destination >= draft.quickAccess.length;
                order.append(move);
            }
            row.append(order);
        }
        list.append(row);
    }

    function renderLists() {
        const entries = workbenchEntries();
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        pinned.replaceChildren();
        if (!draft.quickAccess.length) pinned.append(element('small', '在结果旁点「加入常用」，保存修改后可跨模板使用。'));
        for (const [index, id] of draft.quickAccess.entries()) {
            const entry = byId.get(id) ?? { id, title: id.split('/').at(-1), context: '菜单项暂不可用', unavailable: true };
            renderEntry(entry, pinned, index);
        }
        results.replaceChildren();
        const searching = Boolean(workbenchQuery.trim());
        const found = searching ? searchWorkbench(entries, workbenchQuery) : entries.slice(0, Object.keys(WORKBENCH_ACTIONS).length);
        if (searching) favorites.before(matches);
        else matches.before(favorites);
        heading.textContent = searching ? '搜索结果' : '常用任务';
        status.textContent = searching ? (found.length ? '匹配 ' + found.length + ' 项' : '没有找到匹配的设置') : '';
        for (const entry of found.slice(0, 35)) renderEntry(entry, results);
        if (found.length > 35) results.append(element('small', '继续输入可缩小搜索范围。'));
    }

    search.addEventListener('input', () => { workbenchQuery = search.value; renderLists(); });
    search.addEventListener('keydown', event => {
        const first = results.querySelector('.tle-quick-open:not(:disabled)');
        if (event.isComposing || !first || !['Enter', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Enter') first.click();
        else first.focus();
    });
    renderLists();
}

function renderBody() {
    refreshShareStatus = undefined;
    refreshFlowMaterials = undefined;
    refreshMaterialShelf = undefined;
    refreshMaterialIndex = undefined;
    refreshMaterialReplacement = undefined;
    const wasComparing = panel.dataset.aiOriginal;
    delete panel.dataset.aiStage;
    delete panel.dataset.aiOriginal;
    if (aiPreview || wasComparing) {
        aiPreview = undefined;
        refreshPreview();
    }
    const mainPage = page === 'workbench' ? workbenchReturn : page;
    const tabPage = ['ai', 'materials'].includes(mainPage) ? 'appearance' : mainPage;
    for (const tab of panel.querySelectorAll('[data-section]')) tab.setAttribute('aria-pressed', String(tab.dataset.section === tabPage));
    body.replaceChildren();
    body.scrollTop = 0;
    const flow = activeThemeFlow();
    if (flow && themeSteps.some(([step]) => step === page)) renderThemeSteps(flow);
    if (page === 'workbench') return renderWorkbench();
    if (page === 'review') return renderReview();
    if (page === 'ai') return renderAiLayout();
    if (page === 'materials') {
        if (flow && !flow.fullMaterials) return renderThemeMaterials(flow);
        return renderMaterials();
    }
    if (page === 'templates') {
        renderTemplates();
        const checkpoint = renderParkedDraft();
        if (checkpoint) body.prepend(checkpoint);
        return;
    }
    if (page === 'menus') {
        menuEditor.render(body, false, pickedMenu);
        const checkpoint = renderParkedDraft();
        if (checkpoint && !pickedMenu) body.prepend(checkpoint);
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
    clearPositionClipboard();
    editorViewport?.abort();
    editorViewport = undefined;
    panel?.remove();
    panel = body = status = message = draft = history = undefined;
    invalidUrls.clear();
    importedParts = undefined;
    aiPreview = undefined;
    openingLayout = openingTemplateId = undefined;
    themeFlow = refreshFlowMaterials = undefined;
    refreshShareStatus = undefined;
    resumedParkedId = undefined;
    openReviewAreas.clear();
    reviewSelection.clear();
    reviewSelectionOwner = undefined;
    workbenchQuery = '';
    workbenchReturn = 'menus';
    organizeQuickAccess = false;
    reviewFilter = 'all';
    reviewBatch = false;
    aiGoal = '';
    aiSessions.clear();
    materialKey = '';
    recentMaterials.clear();
    refreshMaterialShelf = undefined;
    refreshMaterialIndex = undefined;
    refreshMaterialReplacement = undefined;
    Object.assign(materialIndex, { query: '', filter: 'all', imageFilter: 'all', mode: 'positions', open: false });
    partsSource = '';
    refreshPreview();
    (document.querySelector('#extensionsMenuButton') ?? menu?.firstElementChild)?.focus();
}

function openEditor(initial) {
    if (applying) return;
    if (panel) {
        if (photoPending()) return setMessage('正在处理照片，请稍候。');
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
    const cancel = button('取消', closeEditor);
    actions.append(
        cancel,
        button('暂存并关闭', parkCurrentDraft),
        button('保存修改', async () => {
            if (applying) return;
            if (photoPending()) return setMessage('正在处理照片，请稍候。');
            if (aiPreview) return setMessage('请先接受所选排版或结束试套。');
            if (invalidUrls.size) return setMessage('请先修正或清空无效图片 URL。');
            const next = structuredClone(draft);
            if (next.auto && !next.manual && saved.templates[saved.active] && next.templates[saved.active]) next.active = saved.active;
            const changed = !equalSettings(next, saved);
            const revision = changed ? templateId() : savedRevision;
            const checkpoint = changed && resumedParkedId && resumedParkedId === parkedDraft?.id ? undefined : parkedDraft;
            setMessage('正在保存修改…');
            if (await persistEditorSettings(next, revision, checkpoint)) {
                saved = next;
                savedRevision = revision;
                parkedDraft = checkpoint;
                sceneActive = undefined;
                closeEditor();
                reconcileScene(true);
            }
        }, 'menu_button tle-primary'),
    );
    panel.addEventListener('click', event => {
        if (!photoPending() || cancel.contains(event.target) || !(event.target instanceof Element) ||
            !event.target.closest('button, select, summary, input[type="checkbox"]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setMessage('正在处理照片，请稍候。');
    }, true);
    panel.addEventListener('focusout', event => {
        if (history?.field === event.target) history.field = null;
    });
    panel.addEventListener('keydown', event => {
        if (photoPending() && !['Tab', 'Escape'].includes(event.key) && event.target !== cancel) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            toggleWorkbench();
            return;
        }
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
            else if (page === 'workbench') toggleWorkbench();
            else closeEditor();
        }
    });
    pickButton = button('点选酒馆里的元素', event => {
        if (previewMenu) event.stopPropagation();
        setPicking(!picking);
    }, 'menu_button tle-pick');
    const header = element('header', '', 'tle-ui-header');
    const titleRow = element('div', '', 'tle-title-row');
    const quick = button('快速定位', toggleWorkbench, 'menu_button tle-workbench-launch');
    quick.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    titleRow.append(heading, status, quick);
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
    loadEditorSettings();
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
    loadEditorSettings();
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
