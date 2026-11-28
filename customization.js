import { BREAKPOINT, COMPOSER_BUTTONS, MESSAGE_INFO, effectiveFields } from './model.mjs';

export function createCustomization(isTauriTavern) {
    const mobile = matchMedia('(max-width: ' + BREAKPOINT + 'px)');
    const moved = new Map();
    const decorated = new Map();
    let layout;
    let observer;
    let frame;
    let more;
    let messageInfo = {};
    let signature = '';

    function restoreButtons() {
        for (const [node, { anchor, parent, order }] of moved) {
            if (anchor.parentNode) anchor.replaceWith(node);
            else if (parent.isConnected) parent.append(node);
            node.removeAttribute('data-tle-relocated');
            if (order.value) node.style.setProperty('order', order.value, order.priority);
            else node.style.removeProperty('order');
        }
        moved.clear();
        more?.remove();
        more = undefined;
    }

    function addMore(container) {
        more = document.createElement('details');
        more.id = 'tle-composer-more';
        const summary = document.createElement('summary');
        summary.textContent = '消息更多';
        const actions = document.createElement('div');
        for (const [label, selector] of [['编辑末条', '.mes_edit'], ['复制末条', '.mes_copy'], ['重抽', '#option_regenerate']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'menu_button';
            button.textContent = label;
            button.addEventListener('click', () => {
                const target = selector.startsWith('#') ? document.querySelector(selector)
                    : document.querySelector('#chat .last_mes ' + selector);
                if (!target) return;
                more.open = false;
                if (selector === '.mes_copy' && !isTauriTavern()) {
                    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true }));
                } else {
                    target.click();
                }
            });
            actions.append(button);
        }
        more.addEventListener('toggle', () => {
            for (const [index, selector] of ['.mes_edit', '.mes_copy'].entries()) {
                actions.children[index].disabled = !document.querySelector('#chat .last_mes ' + selector);
            }
        });
        more.append(summary, actions);
        container.append(more);
    }

    function renderButtons() {
        restoreButtons();
        if (!layout || !mobile.matches) return;
        const values = effectiveFields(layout, 'mobile', 'mobileComposer');
        const left = document.getElementById('leftSendForm');
        const right = document.getElementById('rightSendForm');
        if (!left || !right) return;
        for (const [key, [, id]] of Object.entries(COMPOSER_BUTTONS)) {
            const node = document.getElementById(id);
            const side = values[key];
            const rank = values[key + 'Order'];
            if (!node || (!side && rank === undefined) || (side === 'native' && rank === undefined)) continue;
            const anchor = document.createComment('纯白：按钮原位');
            const order = { value: node.style.getPropertyValue('order'), priority: node.style.getPropertyPriority('order') };
            node.before(anchor);
            moved.set(node, { anchor, parent: node.parentElement, order });
            node.setAttribute('data-tle-relocated', '');
            if (side === 'left' && node.parentElement !== left) left.append(node);
            if (side === 'right' && node.parentElement !== right) right.append(node);
            if (rank !== undefined) node.style.setProperty('order', String(rank), 'important');
        }
        if (values.more === 'on') addMore(left);
    }

    function resetMessage(message, entry) {
        entry.button?.remove();
        entry.model?.remove();
        message.removeAttribute('data-tle-meta-open');
        if (entry.reasoning && entry.reasoning.open === entry.appliedOpen) entry.reasoning.open = entry.initialOpen;
    }

    function updateMessages() {
        frame = undefined;
        const fields = Object.keys(MESSAGE_INFO);
        for (const [message, entry] of decorated) {
            if (message.isConnected && message.getAttribute('mesid') === entry.messageId) continue;
            resetMessage(message, entry);
            decorated.delete(message);
        }
        for (const message of document.querySelectorAll('#chat .mes')) {
            const timestamp = message.querySelector('.timestamp');
            if (!timestamp) continue;
            const entry = decorated.get(message) ?? { messageId: message.getAttribute('mesid') };
            decorated.set(message, entry);
            const title = timestamp.getAttribute('title') ?? '';
            const model = title.includes(' - ') ? title.slice(title.indexOf(' - ') + 3).trim() : '';
            if (model && ['show', 'details'].includes(messageInfo.model)) {
                if (!entry.model?.isConnected) {
                    entry.model = document.createElement('small');
                    entry.model.className = 'tle-model-name';
                    timestamp.after(entry.model);
                }
                if (entry.model.textContent !== model) entry.model.textContent = model;
            } else {
                entry.model?.remove();
            }
            const hasDetails = fields.some(key => messageInfo[key] === 'details' &&
                (key === 'model' ? model || message.querySelector('.timestamp-icon') : message.querySelector(MESSAGE_INFO[key])?.textContent?.trim()));
            if (hasDetails && !entry.button?.isConnected) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'tle-meta-toggle menu_button';
                toggle.textContent = '消息信息';
                toggle.setAttribute('aria-expanded', String(message.hasAttribute('data-tle-meta-open')));
                toggle.addEventListener('click', () => {
                    const open = !message.hasAttribute('data-tle-meta-open');
                    if (open) message.setAttribute('data-tle-meta-open', '');
                    else message.removeAttribute('data-tle-meta-open');
                    toggle.setAttribute('aria-expanded', String(open));
                });
                timestamp.parentElement.after(toggle);
                entry.button = toggle;
            } else if (!hasDetails) {
                entry.button?.remove();
                message.removeAttribute('data-tle-meta-open');
            }
            const reasoning = message.querySelector('.mes_reasoning_details[data-has-content="true"]');
            if (reasoning && entry.reasoning !== reasoning && ['expanded', 'collapsed'].includes(messageInfo.reasoning)) {
                entry.reasoning = reasoning;
                entry.initialOpen = reasoning.open;
                entry.appliedOpen = messageInfo.reasoning === 'expanded';
                reasoning.open = entry.appliedOpen;
            }
        }
    }

    function refreshMessages() {
        observer?.disconnect();
        observer = undefined;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        for (const [message, entry] of decorated) resetMessage(message, entry);
        decorated.clear();
        if (!layout) return;
        messageInfo = effectiveFields(layout, mobile.matches ? 'mobile' : 'desktop', 'messageInfo');
        if (messageInfo.model !== 'show' && !Object.values(messageInfo).some(value => ['details', 'expanded', 'collapsed'].includes(value))) return;
        const chat = document.getElementById('chat');
        if (!chat) return;
        updateMessages();
        observer = new MutationObserver(() => {
            if (frame === undefined) frame = requestAnimationFrame(updateMessages);
        });
        observer.observe(chat, { subtree: true, childList: true, characterData: true, attributes: true,
            attributeFilter: ['title', 'mesid', 'data-has-content'] });
    }

    function onViewportChange() {
        renderButtons();
        refreshMessages();
    }

    return {
        start() {
            mobile.addEventListener('change', onViewportChange);
        },
        update(template) {
            const next = JSON.stringify([template.desktop.messageInfo, template.mobile.messageInfo, template.desktop.mobileComposer, template.mobile.mobileComposer]);
            layout = template;
            if (next === signature) return;
            signature = next;
            onViewportChange();
        },
        stop() {
            mobile.removeEventListener('change', onViewportChange);
            layout = undefined;
            signature = '';
            onViewportChange();
        },
    };
}


