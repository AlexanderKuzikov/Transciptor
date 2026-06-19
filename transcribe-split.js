import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
    apiKey: process.env.ROUTERAI_API_KEY,
    inputDir: process.env.INPUT_DIR || './audio',
    outputDir: process.env.OUTPUT_DIR || './output',
    tempDir: './temp',
    model: 'qwen/qwen3-asr-flash-2026-02-10',
    apiUrl: 'https://routerai.ru/api/v1/audio/transcriptions',
    language: 'ru',
    delayBetweenRequests: 1500,
    maxRetries: 3,
    stateFile: '.transcribe-state.json',
    
    // Параметры разбиения
    chunkDuration: 300,      // 5 минут на часть (в секундах)
    overlapDuration: 15,     // 15 секунд перекрытия
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
    ? { info: 'ℹ', ok: '✓', err: '✗', warn: '⚠', run: '▶', mic: '🎙', chart: '📊' }
    : { info: '[i]', ok: '[+]', err: '[-]', warn: '[!]', run: '>', mic: '[REC]', chart: '[STAT]' };

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
        return { processed: [], failed: [] };
    }
}

async function saveState(state) {
    await fs.writeFile(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

// ===== ПОЛУЧЕНИЕ ДЛИТЕЛЬНОСТИ АУДИО =====
async function getAudioDuration(filePath) {
    try {
        const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
        return parseFloat(stdout.trim());
    } catch (error) {
        throw new Error(`Не удалось получить длительность: ${error.message}`);
    }
}

// ===== РАЗБИЕНИЕ НА ЧАСТИ =====
async function splitAudio(filePath, outputDir, baseName, format) {
    const duration = await getAudioDuration(filePath);
    const chunks = [];
    
    let startTime = 0;
    let chunkIndex = 0;
    
    while (startTime < duration) {
        const chunkDuration = Math.min(CONFIG.chunkDuration, duration - startTime);
        const chunkFile = path.join(outputDir, `${baseName}_part${chunkIndex}.${format}`);
        
        // ffmpeg команда для извлечения части
        const cmd = `ffmpeg -y -i "${filePath}" -ss ${startTime} -t ${chunkDuration} -c copy "${chunkFile}"`;
        
        try {
            await execAsync(cmd);
            chunks.push({
                file: chunkFile,
                startTime: startTime,
                endTime: startTime + chunkDuration,
                index: chunkIndex
            });
            chunkIndex++;
        } catch (error) {
            throw new Error(`Ошибка разбиения части ${chunkIndex}: ${error.message}`);
        }
        
        // Следующая часть начинается с перекрытием
        startTime += CONFIG.chunkDuration - CONFIG.overlapDuration;
        
        // Если следующая часть будет слишком короткой — включаем её в текущую
        if (duration - startTime < 10) {
            break;
        }
    }
    
    return chunks;
}

// ===== ТРАНСКРИБАЦИЯ ФАЙЛА =====
async function transcribeFile(filePath, format) {
    const fileName = path.basename(filePath);
    const fileSize = (await fs.stat(filePath)).size;
    const base64Data = (await fs.readFile(filePath)).toString('base64');
    
    const body = {
        model: CONFIG.model,
        input_audio: { data: base64Data, format },
        language: CONFIG.language
    };
    
    const jsonBody = JSON.stringify(body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

    const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinIdx = 0;
    const reqStart = Date.now();
    
    const heartbeat = setInterval(() => {
        const elapsed = Math.floor((Date.now() - reqStart) / 1000);
        const spin = spinChars[spinIdx++ % spinChars.length];
        process.stdout.write(`\r\x1b[K${c.cyan}${spin}${c.reset} ${fileName} (${formatSize(fileSize)}) — ${elapsed}с`);
    }, 200);

    try {
        const response = await fetch(CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: jsonBody,
            signal: controller.signal
        });

        clearInterval(heartbeat);
        clearTimeout(timeout);
        process.stdout.write('\r\x1b[K');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        
        const result = await response.json();
        const elapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
        return { result, elapsed };

    } catch (error) {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        process.stdout.write('\r\x1b[K');
        
        if (error.name === 'AbortError') {
            throw new Error('Таймаут 10 минут');
        }
        throw error;
    }
}

// ===== ОБРАБОТКА ОДНОГО АУДИОФАЙЛА =====
async function processAudioFile(filePath, format, state) {
    const fileName = path.basename(filePath);
    const baseName = path.parse(fileName).name;
    
    log.info(`Обработка: ${fileName}`);
    
    // Получаем длительность
    const duration = await getAudioDuration(filePath);
    const durationMin = Math.floor(duration / 60);
    const durationSec = Math.floor(duration % 60);
    log.info(`Длительность: ${durationMin}м ${durationSec}с`);
    
    // Если файл короче chunkDuration — не разбиваем
    if (duration <= CONFIG.chunkDuration) {
        log.info(`Файл короткий (${durationMin}м), транскрибирую целиком`);
        
        for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
            try {
                const { result, elapsed } = await transcribeFile(filePath, format);
                log.success(`Готово за ${elapsed}с`);
                return result;
            } catch (error) {
                if (attempt < CONFIG.maxRetries) {
                    log.warn(`Попытка ${attempt}/${CONFIG.maxRetries}: ${error.message}`);
                    await sleep(2000 * attempt);
                } else {
                    throw error;
                }
            }
        }
    }
    
    // Разбиваем на части
    log.info(`Разбиваю на части по ${CONFIG.chunkDuration / 60} мин с перекрытием ${CONFIG.overlapDuration}с`);
    await fs.mkdir(CONFIG.tempDir, { recursive: true });
    
    const chunks = await splitAudio(filePath, CONFIG.tempDir, baseName, format);
    log.info(`Получено частей: ${chunks.length}`);
    
    // Транскрибируем каждую часть
    const transcripts = [];
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        log.info(`Часть ${i + 1}/${chunks.length}: ${Math.floor(chunk.startTime / 60)}м${Math.floor(chunk.startTime % 60)}с — ${Math.floor(chunk.endTime / 60)}м${Math.floor(chunk.endTime % 60)}с`);
        
        let success = false;
        for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
            try {
                const { result, elapsed } = await transcribeFile(chunk.file, format);
                log.success(`Часть ${i + 1} готова за ${elapsed}с`);
                transcripts.push({
                    startTime: chunk.startTime,
                    endTime: chunk.endTime,
                    text: result.text || result.transcription || JSON.stringify(result)
                });
                success = true;
                break;
            } catch (error) {
                if (attempt < CONFIG.maxRetries) {
                    log.warn(`Попытка ${attempt}/${CONFIG.maxRetries}: ${error.message}`);
                    await sleep(2000 * attempt);
                } else {
                    log.error(`Часть ${i + 1} провалена: ${error.message}`);
                    transcripts.push({
                        startTime: chunk.startTime,
                        endTime: chunk.endTime,
                        text: `[ОШИБКА: ${error.message}]`
                    });
                }
            }
        }
        
        if (i < chunks.length - 1) {
            await sleep(CONFIG.delayBetweenRequests);
        }
    }
    
    // Склеиваем результаты
    const fullText = transcripts
        .map(t => `[${Math.floor(t.startTime / 60)}:${String(Math.floor(t.startTime % 60)).padStart(2, '0')} - ${Math.floor(t.endTime / 60)}:${String(Math.floor(t.endTime % 60)).padStart(2, '0')}]\n${t.text}`)
        .join('\n\n');
    
    // Удаляем временные файлы
    for (const chunk of chunks) {
        try {
            await fs.unlink(chunk.file);
        } catch {}
    }
    
    return { text: fullText };
}

// ===== ГЛАВНАЯ =====
async function main() {
    if (!CONFIG.apiKey) {
        log.error('Не задан ROUTERAI_API_KEY');
        process.exit(1);
    }

    console.log(`\n${c.bright}${icons.mic} Транскрибация с разбиением${c.reset}`);
    log.info(`Модель: ${CONFIG.model}`);
    log.info(`Части: ${CONFIG.chunkDuration / 60} мин | Перекрытие: ${CONFIG.overlapDuration}с\n`);

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

    log.info(`Всего: ${audioFiles.length} | Осталось: ${pendingFiles.length}\n`);

    const startTime = Date.now();
    let success = 0, failed = 0;

    for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        
        try {
            const result = await processAudioFile(file.path, file.format, state);
            const outPath = path.join(CONFIG.outputDir, path.parse(file.name).name + '.txt');
            const text = result.text || result.transcription || JSON.stringify(result, null, 2);
            await fs.writeFile(outPath, text, 'utf-8');
            
            state.processed.push(file.name);
            await saveState(state);
            success++;
            
            log.success(`Сохранено: ${path.basename(outPath)}\n`);
        } catch (error) {
            state.failed.push({ file: file.name, error: error.message });
            await saveState(state);
            failed++;
            log.error(`${file.name}: ${error.message}\n`);
        }
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n${c.bright}${icons.chart} Итого:${c.reset}`);
    log.success(`Успешно: ${success}`);
    if (failed > 0) log.error(`С ошибками: ${failed}`);
    log.info(`Время: ${formatTime(totalTime)}`);
    console.log();
}

main().catch(err => {
    log.error(`Критическая ошибка: ${err.message}`);
    process.exit(1);
});