export function createRuntime({ getLayout, openTemplates, scrollToBottom }) {
    const breakpoint = matchMedia('(max-width: 1000px)');
    let entries;
    let entryMode;
    let lifecycle;

    function addAction(parent, id, label, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = id;
        button.className = 'menu_button';
        button.textContent = label;
        button.addEventListener('click', action);
        parent.append(button);
    }

    function renderEntries() {
        const template = getLayout();
        const native = document.querySelector('#leftSendForm');
        if (!native) return;
        const settings = { ...template?.desktop.launcher, ...(breakpoint.matches ? template?.mobile.launcher : {}) };
        const mode = settings.entries;
        const signature = JSON.stringify(settings);
        if (signature === entryMode && entries?.isConnected) return;
        entries?.remove();
        entries = undefined;
        entryMode = signature;
        if (!mode || mode === 'none') return;
        entries = document.createElement(mode === 'more' ? 'details' : 'span');
        entries.id = 'tle-entry-list';
        let parent = entries;
        if (mode === 'more') {
            const summary = document.createElement('summary');
            summary.textContent = settings.moreLabel || '更多';
            parent = document.createElement('div');
            entries.append(summary, parent);
        }
        if (mode !== 'theme') addAction(parent, 'tle-bottom', settings.bottomLabel || '到底部', () => {
            entries.open = false;
            scrollToBottom();
        });
        if (mode !== 'bottom') addAction(parent, 'tle-theme', settings.themeLabel || '换主题', () => {
            entries.open = false;
            openTemplates();
        });
        native.append(entries);
    }

    return {
        start() {
            if (lifecycle) return;
            lifecycle = new AbortController();
            breakpoint.addEventListener('change', renderEntries, { signal: lifecycle.signal });
            renderEntries();
        },
        update: renderEntries,
        stop() {
            lifecycle?.abort();
            lifecycle = undefined;
            entries?.remove();
            entries = undefined;
            entryMode = undefined;
        },
    };
}
