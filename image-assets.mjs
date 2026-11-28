export const MAX_TEMPLATE_FILE = 12 * 1024 * 1024;
const MAX_INLINE_LENGTH = 512 * 1024;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export function normalizeInlineImage(value) {
    if (typeof value !== 'string' || value.length > MAX_INLINE_LENGTH) return undefined;
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) return undefined;
    const [, type, payload] = match;
    const bytes = atob(payload.slice(0, 16));
    if (type === 'jpeg' && bytes.startsWith('\xff\xd8\xff')) return value;
    if (type === 'png' && bytes.startsWith('\x89PNG\r\n\x1a\n')) return value;
    if (type === 'webp' && bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP') return value;
    return undefined;
}

async function readPhoto(file) {
    if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('请选择 25 MB 以内的照片。');
    const type = file.type.toLowerCase();
    if (!/^image\/(?:jpeg|png|webp|heic|heif|avif|gif|bmp|tiff)$/.test(type) &&
        !(type === '' && /\.(?:jpe?g|png|webp|heic|heif|avif|gif|bmp|tiff?)$/i.test(file.name))) {
        throw new Error('请选择 JPG、PNG、WebP 或设备能读取的照片。');
    }
    const source = URL.createObjectURL(file);
    const image = new Image();
    const canvas = document.createElement('canvas');
    try {
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('无法读取这张照片，请试试 JPG 或 PNG。'));
            image.src = source;
        });
        const context = canvas.getContext('2d');
        if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error('无法读取这张照片。');
        const longest = Math.max(image.naturalWidth, image.naturalHeight);
        for (const limit of [1600, 1200, 900, 650, 440, 300, 220]) {
            const scale = Math.min(1, limit / longest);
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const encoded = canvas.toDataURL('image/webp', .84);
            const result = normalizeInlineImage(encoded);
            if (result) return result;
        }
        throw new Error('这张照片压缩后仍太大，请换一张。');
    } finally {
        URL.revokeObjectURL(source);
        canvas.width = canvas.height = 1;
    }
}

export function createPhotoPicker({ onSelect, setMessage, label, urlInput, canSelect, successMessage = '已载入本地照片，保存后保留。' }) {
    const tools = document.createElement('span');
    tools.className = 'tle-photo-tools';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.hidden = true;
    picker.setAttribute('aria-label', label + ' · 本地照片');
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'menu_button';
    choose.textContent = '选本地照片';
    choose.addEventListener('click', () => {
        if (canSelect && !canSelect()) setMessage('请至少选择一个要换图的位置。');
        else picker.click();
    });
    picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        picker.value = '';
        if (!file) return;
        choose.disabled = urlInput.disabled = true;
        setMessage('正在处理照片…');
        try {
            const image = await readPhoto(file);
            if (!tools.isConnected) return;
            urlInput.value = '';
            urlInput.placeholder = '已使用本地照片';
            urlInput.setAttribute('aria-invalid', 'false');
            onSelect(image);
            setMessage(successMessage);
        } catch (error) {
            if (tools.isConnected) setMessage(error.message || '无法处理照片。');
        } finally {
            choose.disabled = urlInput.disabled = false;
        }
    });
    tools.append(picker, choose);
    return tools;
}
