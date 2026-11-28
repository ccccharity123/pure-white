import { IMAGE_SIZE_OPTIONS, imageCoordinates, imagePosition, imageSize } from './image-assets.mjs';
import { cssString } from './model.mjs';

export function pictureTravel(frame, picture, size) {
    const [width, height] = frame;
    const [naturalWidth, naturalHeight] = picture;
    if (!width || !height || !naturalWidth || !naturalHeight || size === '100% 100%') return [0, 0];
    let scale = 1;
    if (size === 'cover') scale = Math.max(width / naturalWidth, height / naturalHeight);
    else if (size === 'contain') scale = Math.min(width / naturalWidth, height / naturalHeight);
    else if (size.endsWith('% auto')) scale = width * Number.parseFloat(size) / 100 / naturalWidth;
    return [width - naturalWidth * scale, height - naturalHeight * scale];
}

const clampPercent = value => Math.max(0, Math.min(100, Math.round(value)));
const axes = ['imageX', 'imageY'];
export function dragPicture(origin, travel, movement) {
    const changes = {};
    for (const [i, key] of axes.entries()) {
        if (Math.abs(travel[i]) < 1 || movement[i] === 0) continue;
        const next = clampPercent(origin[i] + 100 * movement[i] / travel[i]);
        if (next !== origin[i]) changes[key] = next;
    }
    return changes;
}

export function zoomPicture(frame, picture, size, origin, from, to, factor) {
    if ([...frame, ...picture].some(length => !Number.isFinite(length) || length <= 0) || !Number.isFinite(factor) || factor < 0) return {};
    const travel = pictureTravel(frame, picture, size);
    const rendered = frame.map((length, axis) => length - travel[axis]);
    const percent = 100 * rendered[0] / frame[0];
    const target = Math.max(1, Math.min(300, Math.round(percent * factor)));
    if (factor === 1 || (factor > 1 && target <= percent) || (factor < 1 && target >= percent)) {
        return dragPicture(origin, travel, to.map((edge, axis) => edge - from[axis]));
    }
    const nextTravel = pictureTravel(frame, picture, target + '% auto');
    const changes = { imageScale: target };
    for (const [axis, key] of axes.entries()) {
        if (Math.abs(nextTravel[axis]) < 1) continue;
        const start = travel[axis] * origin[axis] / 100;
        const anchor = Math.max(0, Math.min(1, (from[axis] - start) / rendered[axis]));
        const scaledLength = frame[axis] - nextTravel[axis];
        const next = clampPercent(100 * (to[axis] - anchor * scaledLength) / nextTravel[axis]);
        if (next !== origin[axis]) changes[key] = next;
    }
    return changes;
}

function pointerBounds(points, frame) {
    const [a, b = a] = points.values();
    const box = frame.getBoundingClientRect();
    return {
        center: [(a.x + b.x) / 2 - box.left - frame.clientLeft, (a.y + b.y) / 2 - box.top - frame.clientTop],
        distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
}

const pads = new WeakMap();
let framingClipboard;

export function clearPositionClipboard() {
    framingClipboard = undefined;
}

export function capturePictureFraming(values, preset, fallbackSize = 'cover') {
    const [imageX, imageY] = imageCoordinates(values, preset);
    return { imageX, imageY, imageScale: values.imageScale || 0, size: values.size ?? fallbackSize };
}

export function refreshPositionPads(root, retryUrl) {
    for (const node of root?.querySelectorAll('.tle-image-position') ?? []) pads.get(node)?.(retryUrl);
}

export function focusPositionPad(root, scroll, pasted) {
    const frame = root.querySelector('.tle-image-position-frame');
    const details = frame?.closest('details');
    if (details) details.open = true;
    const paste = pasted && frame?.parentElement.querySelector('[data-tle-paste-framing="' + pasted + '"]');
    if (paste) paste.closest('details').open = true;
    root.scrollTop = scroll;
    (paste || frame)?.focus({ preventScroll: true });
}

export function createPositionPad({ read, apply, button, label, selector, preset, fallbackSize = 'cover' }) {
    const root = document.createElement('div');
    root.className = 'tle-image-position';
    const frame = document.createElement('div');
    frame.className = 'tle-image-position-frame';
    frame.tabIndex = 0;
    frame.setAttribute('role', 'group');
    frame.setAttribute('aria-label', '拖动图片取景');
    const caption = document.createElement('small');
    let probe;
    let source = '';
    let ready = false;
    let gesture;
    let shownClipboard = null;
    const center = button('居中取景', () => {
        if (!ready || gesture || busy()) return;
        const [x, y] = imageCoordinates(read(), preset);
        if (x !== 50 || y !== 50) apply({ imageX: 50, imageY: 50 });
    });
    const zoomOut = button('缩小', () => zoomAtCenter(1 / 1.18));
    zoomOut.setAttribute('aria-label', '缩小取景');
    const zoomIn = button('放大', () => zoomAtCenter(1.18));
    zoomIn.setAttribute('aria-label', '放大取景');
    const scale = document.createElement('small');
    const tools = document.createElement('div');
    tools.className = 'tle-actions tle-position-tools';
    tools.append(zoomOut, zoomIn, center, scale);

    const reuse = document.createElement('details');
    reuse.className = 'tle-ui-disclosure';
    const summary = document.createElement('summary');
    summary.textContent = '复用取景';
    const clipboardStatus = document.createElement('small');
    clipboardStatus.setAttribute('role', 'status');
    const clipboardActions = document.createElement('div');
    clipboardActions.className = 'tle-actions';
    const copy = button('复制此处取景', () => {
        if (gesture || busy()) return;
        const values = read();
        framingClipboard = { framing: capturePictureFraming(values, preset, fallbackSize), url: values.url, label };
        refreshPositionPads(root.closest('.tle-body'));
    });
    const pasteFraming = button('粘贴取景', () => paste(false));
    pasteFraming.dataset.tlePasteFraming = 'framing';
    const pasteImage = button('粘贴图片和取景', () => paste(true));
    pasteImage.dataset.tlePasteFraming = 'image';
    clipboardActions.append(copy, pasteFraming, pasteImage);
    reuse.append(summary, clipboardStatus, clipboardActions);
    root.append(frame, tools, caption, reuse);

    function paste(withImage) {
        if (!framingClipboard || gesture || busy()) return;
        const { framing, url } = framingClipboard;
        if (withImage && !url) return;
        apply(withImage ? { ...framing, url } : { ...framing }, withImage ? 'image' : 'framing');
    }

    function paint(values = read()) {
        const size = imageSize(values, fallbackSize);
        frame.style.backgroundSize = size;
        frame.style.backgroundPosition = imagePosition(values, preset);
        scale.textContent = values.imageScale > 0 ? values.imageScale + '%' : IMAGE_SIZE_OPTIONS[size];
    }

    function status() {
        frame.dataset.ready = String(ready);
        zoomOut.disabled = zoomIn.disabled = center.disabled = !ready;
        if (ready) caption.textContent = '可拖动、双指缩放或按方向键。松手后应用，整次可撤销。';
        else caption.textContent = source ? '等待图片加载后取景。' : '添加图片后可以拖动取景。';
    }

    function sync(retryUrl) {
        const values = read();
        const url = values.url || '';
        if (url !== source || (url && url === retryUrl)) {
            source = url;
            ready = false;
            finishGesture(false);
            probe = url ? new Image() : undefined;
            frame.style.backgroundImage = 'none';
            if (probe) {
                const image = probe;
                image.referrerPolicy = 'no-referrer';
                image.onload = () => {
                    if (image !== probe) return;
                    ready = true;
                    frame.style.backgroundImage = 'url(' + cssString(source) + ')';
                    status();
                };
                image.onerror = () => {
                    if (image === probe) caption.textContent = '图片加载失败，请检查链接或重试加载。';
                };
                image.src = url;
            }
            status();
        }
        if (!gesture) paint(values);
        if (shownClipboard !== framingClipboard) {
            shownClipboard = framingClipboard;
            pasteFraming.disabled = !framingClipboard;
            pasteImage.disabled = !framingClipboard?.url;
            clipboardStatus.textContent = framingClipboard
                ? '已复制「' + framingClipboard.label + '」的图片位置和缩放。'
                : '先复制这里的取景，再到其他区域或设备的「复用取景」中粘贴。';
        }
    }

    const busy = () => frame.closest('#tle-editor')?.querySelector('[data-tle-photo-pending]');
    const frameSize = () => [frame.clientWidth, frame.clientHeight];
    const photoSize = () => [probe.naturalWidth, probe.naturalHeight];
    function zoomAtCenter(factor) {
        if (!ready || gesture || busy()) return;
        const values = read();
        const dimensions = frameSize();
        const center = dimensions.map(length => length / 2);
        const changes = zoomPicture(dimensions, photoSize(), imageSize(values, fallbackSize),
            imageCoordinates(values, preset), center, center, factor);
        if (Object.keys(changes).length) apply(changes);
    }

    function rebaseGesture() {
        const values = { ...gesture.original, ...gesture.changes };
        gesture.start = {
            size: imageSize(values, fallbackSize),
            origin: imageCoordinates(values, preset),
            bounds: pointerBounds(gesture.points, frame),
            changes: gesture.changes,
        };
    }

    frame.addEventListener('pointerdown', event => {
        if (!ready || event.button !== 0 || busy()) return;
        if (gesture && (gesture.type !== 'touch' || event.pointerType !== 'touch' || gesture.points.size >= 2)) return;
        gesture ??= { type: event.pointerType, original: read(), points: new Map(), changes: {} };
        gesture.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        rebaseGesture();
        frame.focus({ preventScroll: true });
        frame.setPointerCapture(event.pointerId);
        frame.dataset.dragging = 'true';
    });
    frame.addEventListener('pointermove', event => {
        if (!gesture?.points.has(event.pointerId)) return;
        gesture.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const current = pointerBounds(gesture.points, frame);
        const start = gesture.start;
        const factor = start.bounds.distance > 1 ? current.distance / start.bounds.distance : 1;
        const patch = zoomPicture(frameSize(), photoSize(), start.size, start.origin,
            start.bounds.center, current.center, factor);
        gesture.changes = { ...start.changes, ...patch };
        paint({ ...gesture.original, ...gesture.changes });
    });
    function finishGesture(commit) {
        if (!gesture) return;
        const { changes, points, original } = gesture;
        gesture = undefined;
        delete frame.dataset.dragging;
        for (const id of points.keys()) if (frame.hasPointerCapture(id)) frame.releasePointerCapture(id);
        const initial = imageCoordinates(original, preset);
        for (const [axis, key] of axes.entries()) if (changes[key] === initial[axis]) delete changes[key];
        if (changes.imageScale === original.imageScale) delete changes.imageScale;
        if (commit && Object.keys(changes).length) apply(changes);
        else paint();
    }
    frame.addEventListener('pointerup', event => {
        if (!gesture?.points.delete(event.pointerId)) return;
        if (gesture.points.size) rebaseGesture();
        else finishGesture(true);
    });
    for (const type of ['pointercancel', 'lostpointercapture']) {
        frame.addEventListener(type, event => {
            if (gesture?.points.has(event.pointerId)) finishGesture(false);
        });
    }

    frame.addEventListener('keydown', event => {
        if (gesture && event.key === 'Escape') {
            event.stopPropagation();
            finishGesture(false);
            return;
        }
        if (!ready || busy()) return;
        if (!event.ctrlKey && !event.metaKey && ['+', '=', '-', '_'].includes(event.key)) {
            event.preventDefault();
            zoomAtCenter(['+', '='].includes(event.key) ? 1.18 : 1 / 1.18);
            return;
        }
        const arrow = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, -1], ArrowDown: [1, 1] }[event.key];
        if (!arrow || gesture) return;
        event.preventDefault();
        const values = read();
        const [axis, direction] = arrow;
        const available = pictureTravel(frameSize(), photoSize(), imageSize(values, fallbackSize))[axis];
        if (Math.abs(available) < 1) return;
        const origin = imageCoordinates(values, preset)[axis];
        const next = clampPercent(origin + direction * Math.sign(available) * (event.shiftKey ? 10 : 2));
        if (next !== origin) apply({ [axes[axis]]: next });
    });
    const bounds = selector ? document.querySelector(selector)?.getBoundingClientRect() : undefined;
    if (bounds?.width && bounds?.height) frame.style.aspectRatio = String(Math.max(1.3, Math.min(4, bounds.width / bounds.height)));
    pads.set(root, sync);
    status();
    sync();
    return root;
}
