import fs from 'fs/promises';
import path from 'path';

// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
    apiKey: process.env.ROUTERAI_API_KEY,
    inputDir: process.env.INPUT_DIR || './audio',
    outputDir: process.env.OUTPUT_DIR || './output',
    model: 'qwen/qwen3-asr-flash-2026-02-10',
    apiUrl: 'https://routerai.ru/api/v1/audio/transcriptions',
    language: 'ru',
    delayBetweenRequests: 1500,
    maxRetries: 3,
    stateFile: '.transcribe-state.json',
    plainMode: process.argv.includes('--plain')
};

const AUDIO_EXTENSIONS = new Set(['.mp3', '.mp4', '.wav', '.webm', '.flac', '.ogg', '.m4a']);

// ===== ТЕРМИНАЛ =====
const termWidth = process.stdout.columns || 80;
const useColors = !CONFIG.plainMode && process.stdout.isTTY;
const useEmoji = !CONFIG.plainMode && process.platform !== 'win32';

const c = useColors ? {
    reset: '\x1b[0m', bright: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m'
} : { reset: '', bright: '', red: '', green: '', yellow: '', blue: '', cyan: '', gray: '' };

const icons = useEmoji
    ? { info: 'ℹ', ok: '✓', err: '✗', warn: '⚠', run: '▶', mic: '🎙', up: '📤', done: '🏁', chart: '📊' }
    : { info: '[i]', ok: '[+]', err: '[-]', warn: '[!]', run: '>', mic: '[REC]', up: '[UP]', done: '[DONE]', chart: '[STAT]' };

// ===== УТИЛИТЫ =====
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const formatTime = ms => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}ч ${m % 60}м`;
    if (m > 0) return `${m}м ${s % 60}с`;
    return `${s}с`;
};

const formatSize = bytes => {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
};

const getAudioFormat = filename => {
    const ext = path.extname(filename).toLowerCase();
    return AUDIO_EXTENSIONS.has(ext) ? ext.slice(1) : null;
};

function truncate(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
}

const log = {
    info: msg => console.log(`${c.blue}${icons.info}${c.reset} ${msg}`),
    success: msg => console.log(`${c.green}${icons.ok}${c.reset} ${msg}`),
    error: msg => console.log(`${c.red}${icons.err}${c.reset} ${msg}`),
    warn: msg => console.log(`${c.yellow}${icons.warn}${c.reset} ${msg}`)
};

// ===== СОСТОЯНИЕ =====
async function loadState() {
    try {
        return JSON.parse(await fs.readFile(CONFIG.stateFile, 'utf-8'));
    } catch {
        return { processed: [], failed: [], startTime: Date.now() };
    }
}

async function saveState(state) {
    await fs.writeFile(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

// ===== ПРОГРЕСС-БАР =====
function renderProgress(current, total, startTime, currentFile) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const elapsed = Date.now() - startTime;
    const eta = current > 0 ? (elapsed / current) * (total - current) : 0;

    const stats = `${current}/${total} (${percent}%) | ${formatTime(elapsed)} | ETA: ${formatTime(eta)}`;
    
    const prefixLen = 2;
    const barBracketsLen = 2;
    const statsLen = stats.length + 3;
    const fileSepLen = currentFile ? 3 : 0;
    
    const fileDisplay = currentFile ? truncate(path.basename(currentFile), 25) : '';
    const fileLen = fileDisplay.length;
    
    const availableForBar = termWidth - prefixLen - barBracketsLen - statsLen - fileSepLen - fileLen;
    const barWidth = Math.max(10, Math.min(40, availableForBar));
    
    const filled = Math.round((current / total) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    
    let line = `${c.cyan}${icons.run}${c.reset} [${bar}] ${stats}`;
    if (fileDisplay) {
        line += ` ${c.gray}|${c.reset} ${c.gray}${fileDisplay}${c.reset}`;
    }
    
    process.stdout.write(`\r\x1b[K${line}`);
    
    if (current === total) {
        process.stdout.write('\n');
    }
}

// ===== ОБРАБОТКА ФАЙЛА =====
async function transcribeFile(filePath, format) {
    const fileName = path.basename(filePath);
    const fileSize = (await fs.stat(filePath)).size;
    
    log.info(`Читаю файл: ${fileName} (${formatSize(fileSize)})`);
    const base64Data = (await fs.readFile(filePath)).toString('base64');
    log.info(`Base64 готов: ${(base64Data.length / 1024 / 1024).toFixed(2)} МБ`);
    
    const body = {
        model: CONFIG.model,
        input_audio: { data: base64Data, format },
        language: CONFIG.language
    };
    
    const jsonBody = JSON.stringify(body);
    log.info(`JSON body: ${(jsonBody.length / 1024 / 1024).toFixed(2)} МБ`);
    log.info(`Отправляю запрос...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000);

    const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinIdx = 0;
    const reqStart = Date.now();
    
    const heartbeat = setInterval(() => {
        const elapsed = Math.floor((Date.now() - reqStart) / 1000);
        const spin = spinChars[spinIdx++ % spinChars.length];
        process.stdout.write(`\r\x1b[K${c.cyan}${spin}${c.reset} Отправка/ожидание: ${elapsed}с`);
    }, 200);

    try {
        const response = await fetch(CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: jsonBody,
            signal: controller.signal,
            timeout: 15 * 60 * 1000
        });

        clearInterval(heartbeat);
        clearTimeout(timeout);
        process.stdout.write('\r\x1b[K');

        log.info(`Получен ответ: HTTP ${response.status}`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText}`);
        }
        
        const result = await response.json();
        const elapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
        log.success(`${fileName} — готово за ${elapsed}с`);
        return result;

    } catch (error) {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        process.stdout.write('\r\x1b[K');
        
        console.error(`\n${c.red}Детали ошибки:${c.reset}`);
        console.error(`  Тип: ${error.name}`);
        console.error(`  Сообщение: ${error.message}`);
        if (error.cause) {
            console.error(`  Причина: ${error.cause.message || error.cause}`);
            if (error.cause.code) console.error(`  Код причины: ${error.cause.code}`);
        }
        if (error.code) console.error(`  Код ошибки: ${error.code}`);
        
        if (error.name === 'AbortError') {
            throw new Error('Таймаут 15 минут');
        }
        throw error;
    }
}

// ===== ГЛАВНАЯ =====
async function main() {
    if (!CONFIG.apiKey) {
        log.error('Не задан ROUTERAI_API_KEY');
        log.info('Запуск: node --env-file=.env transcribe.js');
        process.exit(1);
    }

    console.log(`\n${c.bright}${icons.mic} Транскрибация аудио${c.reset}`);
    log.info(`Модель: ${CONFIG.model}`);
    log.info(`Вход: ${CONFIG.inputDir} → Выход: ${CONFIG.outputDir}`);
    log.info(`Терминал: ${termWidth} колонок | Цвета: ${useColors ? 'да' : 'нет'} | Эмодзи: ${useEmoji ? 'да' : 'нет'}\n`);

    await fs.mkdir(CONFIG.outputDir, { recursive: true });

    const state = await loadState();
    const allFiles = await fs.readdir(CONFIG.inputDir);
    const audioFiles = allFiles
        .filter(f => getAudioFormat(f))
        .map(f => ({ name: f, path: path.join(CONFIG.inputDir, f), format: getAudioFormat(f) }));

    if (audioFiles.length === 0) {
        log.warn('В папке нет аудиофайлов');
        return;
    }

    const pendingFiles = audioFiles.filter(f => !state.processed.includes(f.name));
    
    if (pendingFiles.length === 0) {
        log.success('Все файлы уже обработаны!');
        return;
    }

    log.info(`Всего: ${audioFiles.length} | Осталось: ${pendingFiles.length}${state.processed.length ? ` | Готово: ${state.processed.length}` : ''}\n`);

    const startTime = Date.now();
    let success = 0, failed = 0;

    for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        renderProgress(i, pendingFiles.length, startTime, file.name);

        try {
            const result = await transcribeFile(file.path, file.format);
            const outPath = path.join(CONFIG.outputDir, path.parse(file.name).name + '.txt');
            const text = result.text || result.transcription || JSON.stringify(result, null, 2);
            await fs.writeFile(outPath, text, 'utf-8');
            
            state.processed.push(file.name);
            await saveState(state);
            success++;
            
            if (i < pendingFiles.length - 1) await sleep(CONFIG.delayBetweenRequests);
        } catch (error) {
            state.failed.push({ file: file.name, error: error.message, time: new Date().toISOString() });
            await saveState(state);
            failed++;
            log.error(`${file.name}: ${error.message}`);
        }
    }

    renderProgress(pendingFiles.length, pendingFiles.length, startTime);
    
    const totalTime = Date.now() - startTime;
    console.log(`\n${c.bright}${icons.chart} Итого:${c.reset}`);
    log.success(`Успешно: ${success}`);
    if (failed > 0) log.error(`С ошибками: ${failed}`);
    log.info(`Время: ${formatTime(totalTime)}`);
    
    if (state.failed.length > 0) {
        console.log(`\n${c.yellow}${icons.warn} История ошибок:${c.reset}`);
        state.failed.slice(-5).forEach(f => log.error(`${f.file}: ${f.error}`));
    }
    console.log();
}

main().catch(err => {
    log.error(`Критическая ошибка: ${err.message}`);
    process.exit(1);
});