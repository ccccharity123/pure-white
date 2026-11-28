import { BREAKPOINT } from './model.mjs';
import { MENUS, menuNeedsGrid, menuRank, menuView } from './menus.mjs';

const itemSelector = 'div[id],[data-i18n],.list-group-item,[data-extension-menu-id],button,a,[role="menuitem"],[role="button"]';
const iconSelector = '.extensionsMenuExtensionButton, .fa-solid, .fa-regular, [data-menu-icon]';

function hash(value) {
    let state = 2166136261;
    for (const char of value) state = Math.imul(state ^ char.codePointAt(0), 16777619);
    return (state >>> 0).toString(36);
}

function stableKey(node, wrapper) {
    const explicit = node.getAttribute('data-extension-menu-id');
    if (explicit?.trim()) return 'ext:' + hash(explicit.trim());
    if (/^[a-z][a-z0-9_-]*$/i.test(node.id)) return 'id:' + node.id;
    const locale = node.getAttribute('data-i18n') ?? node.querySelector('[data-i18n]')?.getAttribute('data-i18n');
    if (locale) return 'locale:' + hash([wrapper?.id ?? '', locale].join(':'));
    return '';
}

function candidates(id) {
    const content = document.querySelector(MENUS[id].content);
    if (!content) return [];
    const result = [];
    const counts = new Map();
    function append(node, wrapper) {
        if (node.matches('hr, .tle-native-group, #tle-menu') || [...node.children].some(child => child.id === 'tle-menu')) return;
        const base = stableKey(node, wrapper);
        if (!base) return;
        const count = (counts.get(base) ?? 0) + 1;
        counts.set(base, count);
        result.push({ node, key: count === 1 ? base : base + ':' + count });
    }
    for (const child of content.children) {
        if (id === 'wand' && child.classList.contains('extension_container')) {
            for (const node of child.children) append(node, child);
        } else if (child.matches(itemSelector)) {
            append(child);
        }
    }
    return result;
}

function labelOf(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('.tle-menu-alias, .tle-menu-icon, i, svg, kbd, .shortcut').forEach(item => item.remove());
    return copy.textContent.trim().replace(/\s+/g, ' ') || node.getAttribute('aria-label') || node.title || node.id;
}

function restoreLabel(record) {
    record.alias?.remove();
    record.alias = undefined;
    record.labels?.forEach(node => node.classList.remove('tle-native-old-label'));
    record.labels = [];
    for (const wrap of record.text ?? []) wrap.replaceWith(...wrap.childNodes);
    record.text = [];
}

function setLabel(node, record, label) {
    if (!label) {
        if (record.alias) restoreLabel(record);
        return;
    }
    if (!record.alias?.isConnected) {
        restoreLabel(record);
        record.alias = document.createElement('span');
        record.alias.className = 'tle-menu-alias';
        node.insertBefore(record.alias, [...node.children].find(item => item.matches('kbd, .shortcut, [data-shortcut]')) ?? null);
    }
    if (record.alias.textContent !== label) record.alias.textContent = label;
    const labels = [...node.children].filter(child => child.matches('span, label[data-i18n]') &&
        child.textContent.trim() && !child.matches(iconSelector + ', .tle-menu-alias, .tle-native-old-label, .shortcut, [data-shortcut]') &&
        !child.querySelector('input, kbd, [role], button, [data-shortcut]'));
    record.labels = record.labels.filter(child => child.isConnected);
    if (!record.labels.length && labels.length) {
        labels[0].classList.add('tle-native-old-label');
        record.labels.push(labels[0]);
    }
    for (const child of [...node.childNodes]) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
        const wrapper = document.createElement('span');
        wrapper.className = 'tle-native-old-label';
        child.replaceWith(wrapper);
        wrapper.append(child);
        record.text.push(wrapper);
    }
}

function setIcon(node, record, url) {
    if ((url ?? '') === record.iconUrl) return;
    record.image?.remove();
    record.nativeIcon?.classList.remove('tle-native-old-icon');
    record.iconUrl = url ?? '';
    if (!url) return;
    const image = document.createElement('img');
    image.alt = '';
    image.className = 'tle-menu-icon';
    image.hidden = true;
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => {
        if (!image.isConnected) return;
        record.nativeIcon = [...node.children].find(item => item.matches(iconSelector) &&
            !item.matches('[aria-checked], [aria-pressed], .fa-check, .fa-square-check'));
        record.nativeIcon?.classList.add('tle-native-old-icon');
        image.hidden = false;
    }, { once: true });
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = url;
    record.image = image;
    node.prepend(image);
}

export function createMenuRuntime() {
    const viewport = matchMedia('(max-width: ' + BREAKPOINT + 'px)');
    const records = new Map();
    const headers = new Map();
    const roots = new Map();
    const moreOpen = new Set();
    let configuration;
    let previousSignature;
    let observer;
    let frame;

    function restore(node, record) {
        restoreLabel(record);
        setIcon(node, record, '');
        delete node.dataset.tleNativeItem;
        delete node.dataset.tleNativeMore;
        node.style.removeProperty('--tle-native-order');
    }

    function clear() {
        for (const [node, record] of records) restore(node, record);
        records.clear();
        for (const node of headers.values()) node.remove();
        headers.clear();
        for (const node of roots.values()) {
            delete node.dataset.tleMenuPosition;
            delete node.dataset.tleMenuFlow;
            delete node.dataset.tleMoreOpen;
            for (const property of ['--tle-menu-left', '--tle-menu-y', '--tle-menu-viewport']) node.style.removeProperty(property);
        }
        roots.clear();
        moreOpen.clear();
    }

    function headerFor(id, group, text, content, order) {
        const key = id + '/' + group;
        let header = headers.get(key);
        if (!header?.isConnected) {
            header = document.createElement(group === 'more' ? 'button' : 'div');
            header.className = 'tle-native-group';
            if (group === 'more') {
                header.type = 'button';
                header.addEventListener('click', event => {
                    event.stopPropagation();
                    if (moreOpen.has(id)) moreOpen.delete(id);
                    else moreOpen.add(id);
                    render();
                });
            }
            content.append(header);
            headers.set(key, header);
        }
        if (header.textContent !== text) header.textContent = text;
        if (group === 'more') header.setAttribute('aria-expanded', String(moreOpen.has(id)));
        if (header.style.order !== String(order)) header.style.order = String(order);
        return key;
    }

    function place(panel, position) {
        const visual = window.visualViewport;
        const height = visual?.height || window.innerHeight;
        const width = visual?.width || window.innerWidth;
        const top = visual?.offsetTop || 0;
        const left = visual?.offsetLeft || 0;
        function css(name, value) {
            if (panel.style.getPropertyValue(name) !== value) panel.style.setProperty(name, value);
        }
        css('--tle-menu-viewport', height + 'px');
        if (!position || position === 'native') {
            delete panel.dataset.tleMenuPosition;
            return;
        }
        if (panel.dataset.tleMenuPosition !== position) panel.dataset.tleMenuPosition = position;
        css('--tle-menu-left', (left + width / 2) + 'px');
        css('--tle-menu-y', (top + (position === 'bottom' ? height - 8 : position === 'center' ? height / 2 : 8)) + 'px');
    }

    function render() {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        if (!configuration) return;
        const active = new Set();
        const activeHeaders = new Set();
        for (const [id, definition] of Object.entries(MENUS)) {
            const panel = document.querySelector(definition.panel);
            const content = document.querySelector(definition.content);
            if (!panel || !content) continue;
            const view = menuView(configuration, id, viewport.matches);
            const grid = menuNeedsGrid(view);
            const items = candidates(id);
            const hasConfiguration = [view.panel, view.items, view.itemStyle, view.entry].some(item => Object.keys(item).length);
            if (!hasConfiguration) continue;
            roots.set(id, panel);
            place(panel, view.panel.position);
            const ordered = Object.values(view.items).some(item => item.group || item.pinned || item.order !== undefined);
            if (ordered) panel.dataset.tleMenuFlow = '';
            else delete panel.dataset.tleMenuFlow;
            if (moreOpen.has(id)) panel.dataset.tleMoreOpen = '';
            else delete panel.dataset.tleMoreOpen;
            const groups = ['more', ...Object.keys(view.groups)];
            const seen = new Set();
            for (const [index, { node, key }] of items.entries()) {
                active.add(node);
                const raw = view.items[key] ?? {};
                const style = { ...view.itemStyle, ...raw };
                const record = records.get(node) ?? {};
                records.set(node, record);
                if (node.dataset.tleNativeItem !== key) node.dataset.tleNativeItem = key;
                setLabel(node, record, style.label);
                setIcon(node, record, style.icon);
                let rank = 0;
                if (grid && ordered) {
                    const group = groups.indexOf(raw.group);
                    const offset = group === 0 ? 80000 : group > 0 ? group * 3000 : 0;
                    rank = menuRank(view, raw, index);
                    if (group >= 0 && !seen.has(raw.group)) {
                        seen.add(raw.group);
                        activeHeaders.add(headerFor(id, raw.group, group === 0 ? '更多' : view.groups[raw.group], content, offset));
                    }
                }
                const previous = node.style.getPropertyValue('--tle-native-order');
                if (rank && previous !== String(rank)) node.style.setProperty('--tle-native-order', String(rank));
                if (!rank && previous) node.style.removeProperty('--tle-native-order');
                if (raw.group === 'more') node.dataset.tleNativeMore = '';
                else delete node.dataset.tleNativeMore;
            }
        }
        for (const [node, record] of records) {
            if (active.has(node)) continue;
            restore(node, record);
            records.delete(node);
        }
        for (const [key, header] of headers) {
            if (activeHeaders.has(key)) continue;
            header.remove();
            headers.delete(key);
        }
    }

    function queue() {
        if (configuration && frame === undefined) frame = requestAnimationFrame(render);
    }

    return {
        items(id) {
            return candidates(id).filter(({ node }) => !node.hidden && !node.classList.contains('displayNone') &&
                (getComputedStyle(node).display !== 'none' || node.hasAttribute('data-tle-native-more')) &&
                node.parentElement?.style.display !== 'none'
            ).map(({ node, key }) => {
                const icon = [...node.children].find(child => child.matches(iconSelector));
                const classes = [...(icon?.classList ?? [])].filter(name => /^fa-[a-z\d-]+$/.test(name));
                return { key, label: labelOf(node), icon: classes };
            });
        },
        hit(target) {
            for (const [id, menu] of Object.entries(MENUS)) {
                const panel = document.querySelector(menu.panel);
                if (target.closest(menu.trigger)) {
                    const open = panel && getComputedStyle(panel).display !== 'none';
                    return { id, scope: 'entry', open };
                }
                if (!target.closest(menu.panel)) continue;
                const item = candidates(id).find(({ node }) => node === target || node.contains(target));
                return item ? { id, scope: 'item', key: item.key } : { id, scope: 'panel' };
            }
            return undefined;
        },
        start() {
            observer = new MutationObserver(mutations => {
                if (mutations.some(mutation => (mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target)?.closest?.('#extensionsMenu, #options') ||
                    [...mutation.addedNodes].some(node => node instanceof Element && node.matches('#extensionsMenu, #options')))) queue();
            });
            observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
                attributeFilter: ['style', 'id', 'data-i18n', 'data-extension-menu-id'] });
            viewport.addEventListener('change', queue);
            window.visualViewport?.addEventListener('resize', queue);
            window.visualViewport?.addEventListener('scroll', queue);
        },
        update(menus) {
            const signature = JSON.stringify(menus);
            if (signature === previousSignature) return;
            previousSignature = signature;
            clear();
            configuration = menus;
            render();
        },
        stop() {
            observer?.disconnect();
            viewport.removeEventListener('change', queue);
            window.visualViewport?.removeEventListener('resize', queue);
            window.visualViewport?.removeEventListener('scroll', queue);
            if (frame !== undefined) cancelAnimationFrame(frame);
            frame = undefined;
            clear();
            configuration = undefined;
            previousSignature = undefined;
        },
    };
}


