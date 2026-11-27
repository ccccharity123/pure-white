import { BREAKPOINT, normalizeUrl } from './model.mjs';
import { MENUS, menuRank, menuView } from './menus.mjs';

const fields = {
    width: ['宽度 (px)', 'number', 180, 720], height: ['最大高度 (px)', 'number', 120, 900],
    gap: ['项目间距 (px)', 'number', 0, 32], columns: ['自定列数', 'number', 1, 3],
    position: ['打开位置', { native: '跟随入口', top: '视口顶部', bottom: '视口底部', center: '视口中央' }],
    background: ['背景图 URL', 'url'], label: ['显示名称', 'text'], icon: ['图标图片 URL', 'url'],
    color: ['文字颜色', 'text'], fill: ['底色', 'text'], opacity: ['不透明度 (%)', 'number', 10, 100],
    radius: ['圆角 (px)', 'number', 0, 48], textSize: ['字号 (px)', 'number', 10, 26],
};
const sizes = { desktop: '桌面', mobile: '手机' };
const itemFields = ['icon', 'color', 'fill', 'radius', 'textSize'];
const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
};

export function createMenuEditor({ getTemplate, onChange, setMessage, getItems, button, onPreview }) {
    let id = 'wand';
    let device = 'desktop';
    let selected = '';
    let appearance = false;
    let styleTarget = 'panel';
    let root;

    function reset() {
        id = 'wand';
        selected = '';
        appearance = false;
        styleTarget = 'panel';
        device = matchMedia('(max-width: ' + BREAKPOINT + 'px)').matches ? 'mobile' : 'desktop';
    }

    function select(hit, mobile) {
        id = hit.id;
        device = mobile ? 'mobile' : 'desktop';
        selected = hit.key ?? '';
        appearance = hit.scope !== 'item';
        styleTarget = hit.scope === 'entry' ? 'entry' : 'panel';
    }

    function model(menuId = id, create = false) {
        if (!create) return getTemplate().menus?.[menuId];
        return ((getTemplate().menus ??= {})[menuId] ??= {});
    }

    function settings(menuId, area, key, create) {
        if (!create) {
            const layer = model(menuId)?.[device];
            return (key ? layer?.items?.[key] : layer?.[area]) ?? {};
        }
        const layer = model(menuId, true)[device] ??= {};
        return key ? ((layer.items ??= {})[key] ??= {}) : (layer[area] ??= {});
    }

    function write(menuId, area, item, key, value) {
        const target = settings(menuId, area, item, true);
        if (value === undefined) delete target[key];
        else target[key] = value;
        onChange();
    }

    function actions(...children) {
        const row = el('div', '', 'tle-actions');
        row.append(...children);
        return row;
    }

    function segmented(label, options, value, change) {
        const row = el('div', '', 'tle-segments');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', label);
        for (const [key, name] of options) {
            const control = button(name, () => change(key));
            control.setAttribute('aria-pressed', String(value === key));
            row.append(control);
        }
        return row;
    }

    function selectField(label, choices, value, change) {
        const row = el('label', label, 'tle-menu-field');
        const control = el('select');
        control.setAttribute('aria-label', label);
        for (const [key, name] of choices) control.add(new Option(name, key));
        control.value = value;
        control.addEventListener('change', () => change(control.value));
        row.append(control);
        return row;
    }

    function field(key, effective, own, change) {
        const [label, type, min, max] = fields[key];
        if (typeof type === 'object') {
            return selectField(label, [['', '沿用默认'], ...Object.entries(type)], own ?? '', value => change(value || undefined));
        }
        const row = el('label', label, 'tle-menu-field');
        const input = el('input');
        input.type = type;
        input.setAttribute('aria-label', label);
        input.value = own ?? '';
        input.placeholder = key === 'icon' || key === 'background' ? String(effective ?? 'https://…') : String(effective ?? '');
        if (min !== undefined) { input.min = min; input.max = max; }
        if (key === 'label') input.maxLength = 64;
        let latest = own;
        function commit(event) {
            if (event.isComposing) return;
            const raw = input.value.trim();
            let value = raw || undefined;
            if (raw && type === 'number') value = Math.min(max, Math.max(min, Math.round(Number(raw))));
            if (raw && type === 'url') value = normalizeUrl(raw);
            if (raw && ['color', 'fill'].includes(key) && !/^#[a-f\d]{6}$/i.test(raw)) value = undefined;
            const invalid = Boolean(raw && (value === undefined || Number.isNaN(value)));
            input.toggleAttribute('aria-invalid', invalid);
            if (invalid) {
                if (event.type === 'change') {
                    input.value = latest ?? '';
                    input.removeAttribute('aria-invalid');
                    setMessage(type === 'url' ? '请输入有效的 HTTPS 图片地址。' : '输入格式不正确。');
                }
                return;
            }
            if (latest !== value) {
                latest = value;
                change(value);
                setMessage('');
            }
        }
        input.addEventListener('input', commit);
        input.addEventListener('change', commit);
        input.addEventListener('compositionend', commit);
        row.append(input);
        return row;
    }

    function disclosure(text) {
        const details = el('details', '', 'tle-ui-disclosure');
        details.append(el('summary', text));
        return details;
    }

    function icon(style, item) {
        const box = el('span', '', 'tle-item-icon');
        box.setAttribute('aria-hidden', 'true');
        if (style.icon) {
            const img = el('img');
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.src = style.icon;
            img.addEventListener('error', () => { box.textContent = '◇'; }, { once: true });
            box.append(img);
        } else if (item.icon?.length) {
            box.append(el('i', '', item.icon.join(' ')));
        } else box.textContent = '◇';
        return box;
    }

    function removeOverride(menuId, area, item) {
        const layer = model(menuId)?.[device];
        if (!layer) return;
        if (item) delete layer.items?.[item];
        else delete layer[area];
        onChange();
        render(root, true);
    }

    function renderAppearance(view) {
        const box = el('section', '', 'tle-edit-card tle-panel-card');
        const title = el('h3', '菜单外观');
        const targets = [['panel', '面板'], ['entry', '入口'], ['itemStyle', '项目风格'], ['global', '全局']];
        box.append(title, segmented('外观对象', targets, styleTarget, key => {
            styleTarget = key;
            render(root, true);
        }));
        const menuId = styleTarget === 'global' ? 'global' : id;
        const area = styleTarget === 'global' ? 'panel' : styleTarget;
        const effective = styleTarget === 'global' ? { ...model('global')?.desktop?.panel, ...(device === 'mobile' ? model('global')?.mobile?.panel : {}) } : view[area];
        const own = settings(menuId, area);
        const change = (key, value) => write(menuId, area, '', key, value);
        const add = (container, keys) => {
            for (const key of keys) container.append(field(key, effective[key], own[key], value => change(key, value)));
        };
        if (area === 'panel') {
            const row = el('div', '', 'tle-column-setting');
            row.append(el('span', '布局'), segmented('列布局', [[1, '单列'], [2, '双列']], effective.columns ?? 1, key => {
                change('columns', key);
                render(root, true);
            }));
            box.append(row);
            add(box, ['width', 'background', 'radius']);
            const more = disclosure('更多设置');
            add(more, ['height', 'gap', 'position', 'fill', 'opacity', 'columns']);
            if (styleTarget === 'global') {
                more.append(el('h4', '全局入口'));
                for (const target of ['entry', 'itemStyle']) {
                    if (target === 'itemStyle') more.append(el('h4', '全局项目'));
                    const common = settings('global', target);
                    for (const key of itemFields) more.append(field(key, common[key], common[key],
                        value => write('global', target, '', key, value)));
                }
            }
            if (menuId !== 'global' && Object.keys(view.groups).length) {
                let group = Object.keys(view.groups)[0];
                more.append(selectField('管理分组', Object.entries(view.groups), group, value => { group = value; }));
                more.append(button('解散所选分组', () => {
                    const menu = model(id);
                    delete menu.groups[group];
                    for (const size of Object.keys(sizes)) {
                        for (const item of Object.values(menu[size]?.items ?? {})) {
                            if (item.group === group) delete item.group;
                        }
                    }
                    onChange();
                    render(root, true);
                }));
            }
            box.append(more);
        } else add(box, itemFields);
        box.append(button('恢复默认', () => removeOverride(menuId, area)));
        return box;
    }

    function orderedItems(view) {
        const entries = getItems(id);
        const known = new Set(entries.map(item => item.key));
        const missing = Object.keys(view.items).filter(key => !known.has(key)).map(key => ({ key, label: key, missing: true }));
        return [...entries, ...missing].map((item, index) => ({ ...item, rank: menuRank(view, view.items[item.key] ?? {}, index) }))
            .sort((a, b) => Number(Boolean(a.missing)) - Number(Boolean(b.missing)) || a.rank - b.rank);
    }

    function reorder(items, view, key, direction) {
        const { group = '', pinned = false } = view.items[key] ?? {};
        const peers = items.filter(item => !item.missing && (view.items[item.key]?.group ?? '') === group &&
            Boolean(view.items[item.key]?.pinned) === pinned);
        const index = peers.findIndex(item => item.key === key);
        const next = index + direction;
        if (index < 0 || next < 0 || next >= peers.length) return;
        [peers[index], peers[next]] = [peers[next], peers[index]];
        for (const [rank, peer] of peers.entries()) settings(id, '', peer.key, true).order = rank + 1;
        onChange();
        render(root, true);
    }

    function itemEditor(item, view, items, rowName, rowIcon) {
        const card = el('div', '', 'tle-item-edit');
        const key = item.key;
        const effective = { ...view.itemStyle, ...view.items[key] };
        const own = settings(id, '', key);
        card.append(field('label', item.label, own.label, value => {
            write(id, '', key, 'label', value);
            rowName.textContent = menuView(getTemplate().menus, id, device === 'mobile').items[key]?.label || item.label;
        }));
        card.append(field('icon', effective.icon, own.icon, value => {
            write(id, '', key, 'icon', value);
            const updated = menuView(getTemplate().menus, id, device === 'mobile');
            rowIcon.replaceChildren(...icon({ ...updated.itemStyle, ...updated.items[key] }, item).childNodes);
        }));
        card.append(actions(button('上移', () => reorder(items, view, key, -1)),
            button('下移', () => reorder(items, view, key, 1)), button('恢复原图标', () => {
                write(id, '', key, 'icon', '');
                render(root, true);
            })));
        const compose = el('form', '', 'tle-group-compose');
        compose.hidden = true;
        const input = el('input');
        input.setAttribute('aria-label', '新分组名称');
        input.placeholder = '分组名称';
        input.maxLength = 40;
        const create = el('button', '创建并移入', 'menu_button tle-primary');
        create.type = 'submit';
        compose.append(input, create);
        compose.addEventListener('submit', event => {
            event.preventDefault();
            const name = input.value.trim();
            if (!name) { input.focus(); return; }
            const groups = model(id, true).groups ??= {};
            let group = Object.keys(groups).find(key => groups[key] === name);
            if (!group && Object.keys(groups).length >= 20) return setMessage('一个菜单最多可建 20 个分组。');
            if (!group) {
                group = 'group-' + Date.now().toString(36) + '-' + Object.keys(groups).length;
                groups[group] = name;
            }
            write(id, '', key, 'group', group);
            render(root, true);
        });
        card.append(selectField('移入分组', [['', '不分组'], ['more', '更多'], ...Object.entries(view.groups), ['new-group', '＋ 新建分组']],
            effective.group ?? '', value => {
                if (value === 'new-group') {
                    compose.hidden = false;
                    input.focus();
                } else {
                    write(id, '', key, 'group', value);
                    render(root, true);
                }
            }), compose);
        const more = disclosure('更多设置');
        for (const fieldKey of itemFields.slice(1)) {
            more.append(field(fieldKey, effective[fieldKey], own[fieldKey], value => write(id, '', key, fieldKey, value)));
        }
        more.append(actions(button('移到第一位', () => {
            Object.assign(settings(id, '', key, true), { group: '', pinned: true, order: 1 });
            for (const [index, peer] of items.filter(peer => peer.key !== key && !peer.missing &&
                view.items[peer.key]?.pinned && !view.items[peer.key]?.group).entries()) {
                settings(id, '', peer.key, true).order = index + 2;
            }
            onChange();
            render(root, true);
        }), button('恢复默认', () => removeOverride(id, '', key))));
        card.append(more);
        return card;
    }

    function render(container, preserve = false, fromPick = false) {
        root = container;
        const scroll = preserve ? root.scrollTop : 0;
        const before = preserve && selected ? [...root.querySelectorAll('[data-menu-row]')].find(row => row.dataset.menuRow === selected)?.getBoundingClientRect().top : undefined;
        root.replaceChildren();
        root.append(segmented('选择菜单', Object.entries(MENUS).map(([key, value]) => [key, value.label]), id, key => {
            id = key;
            selected = '';
            styleTarget = 'panel';
            render(root);
        }));
        const tools = el('div', '', 'tle-menu-tools');
        const appearanceButton = button('菜单外观', () => {
            appearance = !appearance;
            if (appearance) styleTarget = 'panel';
            render(root, true);
        });
        appearanceButton.setAttribute('aria-expanded', String(appearance));
        tools.append(segmented('选择设备', Object.entries(sizes), device, key => {
            device = key;
            render(root, true);
        }), actions(button('预览', event => onPreview(id, event)), appearanceButton));
        root.append(tools);
        const view = menuView(getTemplate().menus, id, device === 'mobile');
        if (appearance) root.append(renderAppearance(view));
        const items = orderedItems(view);
        const list = el('div', '', 'tle-menu-list');
        const head = el('div', '', 'tle-menu-list-head');
        head.append(el('h3', '菜单项目'), el('small', String(items.length) + ' 项'));
        root.append(head, list);
        if (!items.length) list.append(el('p', '打开酒馆菜单后，可在这里编辑已加载的项目。'));
        let previousGroup;
        for (const item of items) {
            const itemStyle = view.items[item.key] ?? {};
            const group = item.missing ? 'missing' : itemStyle.group ?? '';
            if (group && group !== previousGroup) {
                list.append(el('div', group === 'more' ? '更多' : group === 'missing' ? '暂不可用' : view.groups[group], 'tle-menu-group-label'));
            }
            previousGroup = group;
            const row = el('section', '', 'tle-menu-row');
            row.dataset.menuRow = item.key;
            const bar = el('div', '', 'tle-item-bar');
            const expanded = selected === item.key;
            row.dataset.expanded = String(expanded);
            const label = el('span', itemStyle.label || item.label, 'tle-item-name');
            const itemIcon = icon({ ...view.itemStyle, ...itemStyle }, item);
            const open = button('', () => {
                selected = expanded ? '' : item.key;
                render(root, true);
            }, 'tle-item-open');
            open.setAttribute('aria-expanded', String(expanded));
            open.append(itemIcon, label, el('span', expanded ? '⌄' : '›', 'tle-item-chevron'));
            const pin = button(itemStyle.pinned ? '取消置顶' : '置顶', () => {
                write(id, '', item.key, 'pinned', !itemStyle.pinned);
                render(root, true);
            }, 'tle-pin');
            pin.setAttribute('aria-pressed', String(Boolean(itemStyle.pinned)));
            bar.append(open, pin);
            row.append(bar);
            if (expanded) row.append(itemEditor(item, view, items, label, itemIcon));
            list.append(row);
        }
        root.scrollTop = scroll;
        const current = [...list.querySelectorAll('[data-menu-row]')].find(row => row.dataset.menuRow === selected);
        if (current && before !== undefined) root.scrollTop += current.getBoundingClientRect().top - before;
        if (current && fromPick) current.scrollIntoView({ block: 'nearest' });
    }

    return { render, reset, select };
}
