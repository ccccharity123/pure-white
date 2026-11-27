const eggTargets = {
    top: '#top-bar, #top-settings-holder',
    chat: '#chat',
    avatar: '#chat .mes[is_user="false"] .avatar',
    send: '#send_but',
};

export function createRuntime({ getLayout, openTemplates, isPicking, scrollToBottom }) {
    const seen = new Set();
    const breakpoint = matchMedia('(max-width: 1000px)');
    let hold;
    let activePointer;
    let suppressClickUntil = 0;
    let hide;
    let animation;
    let audio;
    let entries;
    let entryMode;
    let lifecycle;

    function config() {
        const template = getLayout();
        const mobile = breakpoint.matches ? template?.mobile : undefined;
        return { ...template?.desktop.egg, ...mobile?.egg };
    }

    function removeEffect() {
        clearTimeout(hide);
        animation?.remove();
        animation = undefined;
    }

    function chime() {
        const Audio = window.AudioContext ?? window.webkitAudioContext;
        if (!Audio) return;
        audio ??= new Audio();
        void audio.resume().catch(() => {});
        const tone = audio.createOscillator();
        const volume = audio.createGain();
        const start = audio.currentTime;
        tone.type = 'sine';
        tone.frequency.setValueAtTime(540, start);
        tone.frequency.exponentialRampToValueAtTime(760, start + .15);
        volume.gain.setValueAtTime(.045, start);
        volume.gain.exponentialRampToValueAtTime(.001, start + .35);
        tone.connect(volume).connect(audio.destination);
        tone.start();
        tone.stop(start + .36);
    }

    function play(v, test = false) {
        const root = document.querySelector('#sheld');
        if (!root) return;
        const id = JSON.stringify([getLayout()?.name, v]);
        if (!test && v.once === 'on' && seen.has(id)) return;
        if (!test && v.once === 'on') {
            seen.add(id);
            if (seen.size > 200) seen.delete(seen.values().next().value);
        }
        removeEffect();
        animation = document.createElement('div');
        animation.className = 'tle-egg';
        animation.dataset.effect = v.effect ?? 'fade';
        animation.dataset.location = v.location ?? 'center';
        animation.setAttribute('role', 'status');
        const duration = v.duration ?? 3;
        animation.style.setProperty('--tle-egg-duration', duration + 's');
        if (v.url) {
            const picture = document.createElement('img');
            picture.alt = '';
            picture.referrerPolicy = 'no-referrer';
            picture.addEventListener('error', () => picture.remove(), { once: true });
            picture.src = v.url;
            animation.append(picture);
        }
        if (v.text) animation.append(document.createTextNode(v.text));
        root.append(animation);
        hide = setTimeout(removeEffect, duration * 1000);
        if (v.sound === 'on') chime();
    }

    function normalTrigger(event) {
        if (event.type === 'click' && Date.now() < suppressClickUntil) {
            suppressClickUntil = 0;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (isPicking()) return;
        const v = config();
        const expected = event.type === 'dblclick' ? 'double' : 'click';
        if (v.enabled === 'on' && (v.trigger ?? 'click') === expected &&
            event.target instanceof Element && event.target.closest(eggTargets[v.target ?? 'top'])) play(v);
    }

    function cancelHold() {
        clearTimeout(hold);
        activePointer = undefined;
    }

    function startHold(event) {
        if (isPicking() || !event.isPrimary || event.button !== 0) return;
        const v = config();
        if (v.enabled !== 'on' || v.trigger !== 'hold' ||
            !(event.target instanceof Element) || !event.target.closest(eggTargets[v.target ?? 'top'])) return;
        cancelHold();
        activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        hold = setTimeout(() => {
            if (isPicking()) return;
            suppressClickUntil = Date.now() + 800;
            play(v);
        }, 550);
    }

    function moveHold(event) {
        if (activePointer?.id === event.pointerId &&
            Math.hypot(activePointer.x - event.clientX, activePointer.y - event.clientY) > 10) cancelHold();
    }

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
            const options = { capture: true, signal: lifecycle.signal };
            document.addEventListener('click', normalTrigger, options);
            document.addEventListener('dblclick', normalTrigger, options);
            document.addEventListener('pointerdown', startHold, options);
            document.addEventListener('pointermove', moveHold, options);
            document.addEventListener('pointerup', cancelHold, options);
            document.addEventListener('pointercancel', cancelHold, options);
            breakpoint.addEventListener('change', renderEntries, { signal: lifecycle.signal });
            renderEntries();
        },
        update() {
            cancelHold();
            removeEffect();
            renderEntries();
        },
        play(v) { play(v, true); },
        stop() {
            lifecycle?.abort();
            lifecycle = undefined;
            cancelHold();
            removeEffect();
            entries?.remove();
            entries = undefined;
            entryMode = undefined;
            if (audio) void audio.close().catch(() => {});
            audio = undefined;
            suppressClickUntil = 0;
            seen.clear();
        },
    };
}
