import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';

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
    stateFile: '.transcribe-state.json'
};

const AUDIO_EXTENSIONS = new Set(['.mp3', '.mp4', '.wav', '.webm', '.flac', '.ogg', '.m4a']);

// ===== УТИЛИТЫ =====
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const formatTime = ms => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}ч ${minutes % 60}м`;
    if (minutes > 0) return `${minutes}м ${seconds % 60}с`;
    return `${seconds}с`;
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

// ===== ЦВЕТА =====
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

const log = {
    info: msg => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    success: msg => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    error: msg => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    warn: msg => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    progress: msg => process.stdout.write(`\r${colors.cyan}▶${colors.reset} ${msg}`)
};

// ===== СОСТОЯНИЕ =====
async function loadState() {
    try {
        const data = await fs.readFile(CONFIG.stateFile, 'utf-8');
        return JSON.parse(data);
    } catch {
        return { processed: [], failed: [], startTime: Date.now() };
    }
}

async function saveState(state) {
    await fs.writeFile(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

// ===== ПРОГРЕСС-БАР =====
function renderProgress(current, total, startTime, currentFile) {
    const percent = Math.round((current / total) * 100);
    const elapsed = Date.now() - startTime;
    const eta = current > 0 ? (elapsed / current) * (total - current) : 0;
    
    const barWidth = 30;
    const filled = Math.round((current / total) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    
    const line = `[${bar}] ${current}/${total} (${percent}%) | Прошло: ${formatTime(elapsed)} | ETA: ${formatTime(eta)}`;
    process.stdout.write(`\r${colors.cyan}▶${colors.reset} ${line}${colors.reset}`);
    
    if (currentFile) {
        process.stdout.write(`\n  ${colors.gray}→ ${currentFile}${colors.reset}`);
    }
    
    if (current === total) {
        process.stdout.write('\n\n');
    }
}

// ===== ОБРАБОТКА ФАЙЛА =====
async function encodeFileToBase64(filePath) {
    const buffer = await fs.readFile(filePath);
    return buffer.toString('base64');
}

async function transcribeFile(filePath, format, state) {
    const fileName = path.basename(filePath);
    const fileSize = (await fs.stat(filePath)).size;
    
    log.progress(`Обработка: ${fileName} (${formatSize(fileSize)})`);
    
    const base64Data = await encodeFileToBase64(filePath);
    
    const body = {
        model: CONFIG.model,
        input_audio: {
            data: base64Data,
            format: format
        },
        language: CONFIG.language
    };

    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
        try {
            const response = await fetch(CONFIG.apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            const result = await response.json();
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

// ===== ГЛАВНАЯ ФУНКЦИЯ =====
async function main() {
    if (!CONFIG.apiKey) {
        log.error('Не задан ROUTERAI_API_KEY в .env');
        log.info('Запустите: node --env-file=.env transcribe.js');
        process.exit(1);
    }

    console.log(`\n${colors.bright}🎙️  Транскрибация аудио${colors.reset}\n`);
    log.info(`Модель: ${CONFIG.model}`);
    log.info(`Вход: ${CONFIG.inputDir}`);
    log.info(`Выход: ${CONFIG.outputDir}\n`);

    await fs.mkdir(CONFIG.outputDir, { recursive: true });

    // Загружаем состояние
    const state = await loadState();
    
    // Сканируем файлы
    const allFiles = await fs.readdir(CONFIG.inputDir);
    const audioFiles = allFiles
        .filter(f => getAudioFormat(f))
        .map(f => ({
            name: f,
            path: path.join(CONFIG.inputDir, f),
            format: getAudioFormat(f)
        }));

    if (audioFiles.length === 0) {
        log.warn('В папке нет аудиофайлов');
        return;
    }

    // Фильтруем уже обработанные
    const pendingFiles = audioFiles.filter(f => !state.processed.includes(f.name));
    
    if (pendingFiles.length === 0) {
        log.success('Все файлы уже обработаны!');
        return;
    }

    log.info(`Найдено файлов: ${audioFiles.length}`);
    log.info(`Осталось обработать: ${pendingFiles.length}`);
    if (state.processed.length > 0) {
        log.info(`Пропущено (уже готовы): ${state.processed.length}`);
    }
    console.log();

    const startTime = Date.now();
    let success = 0;
    let failed = 0;

    for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        
        renderProgress(i, pendingFiles.length, startTime, file.name);

        try {
            const result = await transcribeFile(file.path, file.format, state);
            
            // Сохраняем результат
            const outName = path.parse(file.name).name + '.txt';
            const outPath = path.join(CONFIG.outputDir, outName);
            const text = result.text || result.transcription || JSON.stringify(result, null, 2);
            await fs.writeFile(outPath, text, 'utf-8');
            
            // Обновляем состояние
            state.processed.push(file.name);
            await saveState(state);
            
            success++;
            
            if (i < pendingFiles.length - 1) {
                await sleep(CONFIG.delayBetweenRequests);
            }

        } catch (error) {
            state.failed.push({ file: file.name, error: error.message });
            await saveState(state);
            failed++;
            log.error(`${file.name}: ${error.message}`);
        }
    }

    renderProgress(pendingFiles.length, pendingFiles.length, startTime);
    
    const totalTime = Date.now() - startTime;
    console.log(`${colors.bright}📊 Статистика:${colors.reset}`);
    log.success(`Успешно: ${success}`);
    if (failed > 0) log.error(`С ошибками: ${failed}`);
    log.info(`Общее время: ${formatTime(totalTime)}`);
    
    if (state.failed.length > 0) {
        console.log(`\n${colors.yellow}⚠ Ошибки:${colors.reset}`);
        state.failed.forEach(f => log.error(`${f.file}: ${f.error}`));
    }
    
    console.log();
}

main().catch(err => {
    log.error(`Критическая ошибка: ${err.message}`);
    process.exit(1);
});