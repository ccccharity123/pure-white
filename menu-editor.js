import { MENUS, menuView } from './menus.mjs';
import { normalizeUrl } from './model.mjs';

const formFields = {
    width: ['面板宽度（px）', 'number', 180, 720], height: ['最大高度（px）', 'number', 120, 900],
    columns: ['列数', 'number', 1, 3], gap: ['行距与列距（px）', 'number', 0, 32],
    position: ['打开位置', { native: '跟随入口', top: '视口顶部', bottom: '视口底部', center: '视口中央' }],
    background: ['背景图 HTTPS URL', 'url'], label: ['显示名称', 'text'], icon: ['图标 HTTPS URL', 'url'],
    color: ['颜色（#RRGGBB）', 'text'], fill: ['底色（#RRGGBB）', 'text'],
    opacity: ['底色不透明度（%）', 'number', 10, 100], radius: ['圆角（px）', 'number', 0, 48],
    textSize: ['字号（px）', 'number', 10, 26],
};
const labels = { global: '全局菜单风格', ...Object.fromEntries(Object.entries(MENUS).map(([key, menu]) => [key, menu.label])) };
const element = (tag, value = '') => {
    const node = document.createElement(tag);
    if (value) node.textContent = value;
    return node;
};

export function createMenuEditor({ getTemplate, onChange, setMessage, getItems, button }) {
    let id = 'wand';
    let scope = 'panel';
    let itemKey = '';
    let device = 'desktop';
    let root;

    function select(hit, mobile) {
        id = hit.id;
        scope = hit.scope;
        itemKey = hit.key ?? '';
        device = mobile ? 'mobile' : 'desktop';
    }

    function layer() {
        const menus = getTemplate().menus ??= {};
        const menu = menus[id] ??= {};
        return menu[device] ??= {};
    }

    function values(readOnly) {
        const current = readOnly ? getTemplate().menus?.[id]?.[device] : layer();
        if (readOnly) return scope === 'item' ? current?.items?.[itemKey] ?? {} : current?.[scope] ?? {};
        if (scope === 'item') {
            const items = current.items ??= {};
            return items[itemKey] ??= {};
        }
        return current[scope] ??= {};
    }

    function update(key, value) {
        if (value === undefined) delete values(false)[key];
        else values(false)[key] = value;
        onChange();
    }

    function selectRow(title, options, value, change) {
        const label = element('label', title);
        label.className = 'tle-menu-field';
        const control = element('select');
        control.className = 'text_pole';
        control.setAttribute('aria-label', title);
        for (const [key, name] of options) control.add(new Option(name, key));
        control.value = value;
        control.addEventListener('change', () => change(control.value));
        label.append(control);
        root.append(label);
        return control;
    }

    function field(key, effective) {
        const [title, type, min, max] = formFields[key];
        const own = values(true)[key];
        if (typeof type === 'object') {
            selectRow(title, [['', '沿用默认'], ...Object.entries(type)], own ?? '', value => update(key, value || undefined));
            return;
        }
        const row = element('label', title);
        row.className = 'tle-menu-field';
        const input = element('input');
        input.className = 'text_pole';
        input.setAttribute('aria-label', title);
        input.type = type;
        input.value = own ?? '';
        input.placeholder = String(effective[key] ?? '');
        if (type === 'number') {
            input.min = min;
            input.max = max;
        }
        if (key === 'label') input.maxLength = 64;
        input.addEventListener('change', () => {
            const raw = input.value.trim();
            let value = raw;
            if (type === 'number' && raw) value = Math.min(max, Math.max(min, Math.round(Number(raw))));
            if (type === 'url' && raw) value = normalizeUrl(raw);
            if (['color', 'fill'].includes(key) && raw && !/^#[a-f\d]{6}$/i.test(raw)) value = undefined;
            if (raw && (value === undefined || Number.isNaN(value))) {
                input.value = values(true)[key] ?? '';
                setMessage(type === 'url' ? '请输入有效的 HTTPS 图片 URL。' : '输入格式不正确。');
                return;
            }
            update(key, raw ? value : undefined);
            input.value = raw ? value : '';
            setMessage('');
        });
        row.append(input);
        root.append(row);
    }

    function orderItems(view, visible) {
        const entries = new Map(visible.map(item => [item.key, item]));
        for (const key of Object.keys(view.items)) if (!entries.has(key)) entries.set(key, { key, label: key + '（暂不可用）' });
        return [...entries.values()].map((item, index) => ({ ...item, index })).sort((a, b) => {
            const x = view.items[a.key] ?? {};
            const y = view.items[b.key] ?? {};
            return Number(Boolean(y.pinned)) - Number(Boolean(x.pinned)) ||
                (x.order ?? 1000 + a.index) - (y.order ?? 1000 + b.index);
        });
    }

    function reorder(all, view, action) {
        const item = view.items[itemKey] ?? {};
        const peers = action === 'first' ? all
            : all.filter(entry => (view.items[entry.key]?.group ?? '') === (item.group ?? '') &&
                Boolean(view.items[entry.key]?.pinned) === Boolean(item.pinned));
        const index = peers.findIndex(entry => entry.key === itemKey);
        const next = action === 'first' ? 0 : index + action;
        if (index < 0 || next < 0 || next >= peers.length) return;
        const [entry] = peers.splice(index, 1);
        peers.splice(next, 0, entry);
        const items = layer().items ??= {};
        if (action === 'first') items[itemKey] = { ...items[itemKey], group: '', pinned: true };
        peers.forEach((peer, rank) => { items[peer.key] = { ...items[peer.key], order: rank + 1 }; });
        onChange();
        render(root);
    }

    function groupControls() {
        const current = getTemplate().menus?.[id];
        const group = element('input');
        group.type = 'text';
        group.className = 'text_pole';
        group.placeholder = '例如：不常用';
        group.setAttribute('aria-label', '新分组名称');
        group.maxLength = 40;
        const row = element('div');
        row.className = 'tle-actions';
        row.append(group, button('新建分组', () => {
            const name = group.value.trim();
            if (!name) return setMessage('请填写分组名称。');
            const menus = getTemplate().menus ??= {};
            const menu = menus[id] ??= {};
            const groups = menu.groups ??= {};
            if (Object.keys(groups).length >= 20) return setMessage('一个菜单最多可有 20 个分组。');
            const key = 'group-' + Date.now().toString(36) + '-' + Object.keys(groups).length;
            groups[key] = name;
            onChange();
            render(root);
        }));
        root.append(row);
        const groups = Object.entries(current?.groups ?? {});
        if (!groups.length) return;
        const select = selectRow('管理分组', groups, groups[0][0], () => {});
        root.append(button('删除所选分组', () => {
            const menu = getTemplate().menus[id];
            delete menu.groups[select.value];
            for (const size of ['desktop', 'mobile']) {
                for (const item of Object.values(menu[size]?.items ?? {})) {
                    if (item.group === select.value) delete item.group;
                }
            }
            onChange();
            render(root);
        }));
    }

    function render(container) {
        root = container;
        root.replaceChildren();
        selectRow('菜单', Object.entries(labels), id, next => {
            id = next;
            itemKey = '';
            if (id === 'global' && scope === 'item') scope = 'itemStyle';
            render(root);
        });
        selectRow('设备', [['desktop', '桌面'], ['mobile', '手机覆盖']], device, next => {
            device = next;
            render(root);
        });
        const scopes = [['entry', '菜单入口'], ['panel', '展开面板'], ['itemStyle', '项目统一风格']];
        if (id !== 'global') scopes.push(['item', '单个项目']);
        selectRow('编辑对象', scopes, scope, next => {
            scope = next;
            render(root);
        });
        const view = menuView(getTemplate().menus, id, device === 'mobile');
        if (scope === 'panel' && id !== 'global') groupControls();
        let effective = view[scope];
        if (scope === 'item') {
            const ordered = orderItems(view, getItems(id));
            if (!ordered.some(item => item.key === itemKey)) itemKey = ordered[0]?.key ?? '';
            selectRow('菜单项目', ordered.map(item => [item.key, view.items[item.key]?.label || item.label]), itemKey, next => {
                itemKey = next;
                render(root);
            });
            if (!itemKey) {
                root.append(element('small', '请打开菜单加载项目，或启用对应扩展。'));
                return;
            }
            effective = { ...view.itemStyle, ...view.items[itemKey] };
            const actions = element('div');
            actions.className = 'tle-actions';
            actions.append(button('移到第一位', () => reorder(ordered, view, 'first')),
                button('上移', () => reorder(ordered, view, -1)), button('下移', () => reorder(ordered, view, 1)));
            root.append(actions);
            selectRow('置顶', [['', '沿用默认'], ['yes', '置顶'], ['no', '取消置顶']],
                values(true).pinned === undefined ? '' : values(true).pinned ? 'yes' : 'no',
                value => { update('pinned', value ? value === 'yes' : undefined); render(root); });
            selectRow('移入分组', [['', '沿用默认'], ['ungrouped', '不分组'], ['more', '更多'], ...Object.entries(view.groups)],
                values(true).group === '' ? 'ungrouped' : values(true).group ?? '',
                value => { update('group', value === 'ungrouped' ? '' : value || undefined); render(root); });
        }
        const keys = scope === 'panel' ? ['width', 'height', 'columns', 'gap', 'position', 'background', 'fill', 'opacity', 'radius']
            : [...(scope === 'item' ? ['label'] : []), 'icon', 'color', 'fill', 'radius', 'textSize'];
        for (const key of keys) field(key, effective ?? {});
        root.append(button('恢复此对象默认', () => {
            const current = getTemplate().menus?.[id]?.[device];
            if (!current) return;
            if (scope === 'item') delete current.items?.[itemKey];
            else delete current[scope];
            onChange();
            render(root);
        }));
    }

    return { render, select };
}
