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
    models: [
        { id: 'nvidia/parakeet-tdt-0.6b-v3', suffix: 'parakeet', price: 0.14 },
        { id: 'openai/whisper-large-v3', suffix: 'whisper', price: 0.14 }
    ],
    apiUrl: 'https://routerai.ru/api/v1/audio/transcriptions',
    language: 'ru',
    delayBetweenRequests: 1500,
    maxRetries: 3,
    stateFile: '.transcribe-state.json',
    chunkDuration: 300,      // 5 минут
    overlapDuration: 15,     // 15 секунд перекрытия
    plainMode: process.argv.includes('--plain')
};

const AUDIO_EXTENSIONS = new Set(['.mp3', '.mp4', '.wav', '.webm', '.flac', '.ogg', '.m4a']);

// ===== ТЕРМИНАЛ =====
const termWidth = process.stdout.columns || 80;
const useColors = !CONFIG.plainMode && process.stdout.isTTY;

const c = useColors ? {
    reset: '\x1b[0m', bright: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m'
} : { reset: '', bright: '', red: '', green: '', yellow: '', blue: '', cyan: '', gray: '' };

const icons = { info: '[i]', ok: '[+]', err: '[-]', warn: '[!]', run: '>', mic: '[REC]', chart: '[STAT]' };

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

function isProcessed(state, fileName, modelId) {
    return state.processed.some(p => p.file === fileName && p.model === modelId);
}

// ===== АУДИО УТИЛИТЫ =====
async function getAudioDuration(filePath) {
    const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
    return parseFloat(stdout.trim());
}

async function splitAudio(filePath, outputDir, baseName, format) {
    const duration = await getAudioDuration(filePath);
    const chunks = [];
    let startTime = 0;
    let chunkIndex = 0;
    
    while (startTime < duration) {
        const chunkDuration = Math.min(CONFIG.chunkDuration, duration - startTime);
        const chunkFile = path.join(outputDir, `${baseName}_part${chunkIndex}.${format}`);
        
        await execAsync(`ffmpeg -y -i "${filePath}" -ss ${startTime} -t ${chunkDuration} -c copy "${chunkFile}"`);
        
        chunks.push({ file: chunkFile, startTime, endTime: startTime + chunkDuration, index: chunkIndex });
        chunkIndex++;
        
        startTime += CONFIG.chunkDuration - CONFIG.overlapDuration;
        if (duration - startTime < 10) break;
    }
    
    return chunks;
}

// ===== ТРАНСКРИБАЦИЯ =====
async function transcribeFile(filePath, format, modelId) {
    const fileName = path.basename(filePath);
    const fileSize = (await fs.stat(filePath)).size;
    const base64Data = (await fs.readFile(filePath)).toString('base64');
    
    const body = {
        model: modelId,
        input_audio: { data: base64Data, format },
        language: CONFIG.language
    };
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    const spinChars = ['|', '/', '-', '\\'];
    let spinIdx = 0;
    const reqStart = Date.now();
    
    const heartbeat = setInterval(() => {
        const elapsed = Math.floor((Date.now() - reqStart) / 1000);
        const spin = spinChars[spinIdx++ % spinChars.length];
        process.stdout.write(`\r\x1b[K${c.cyan}${spin}${c.reset} ${truncate(fileName, 40)} (${formatSize(fileSize)}) — ${elapsed}с`);
    }, 200);

    try {
        const response = await fetch(CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
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
        
        if (error.name === 'AbortError') throw new Error('Таймаут 5 минут');
        throw error;
    }
}

// ===== ОБРАБОТКА ФАЙЛА ОДНОЙ МОДЕЛЬЮ =====
async function processAudioFile(filePath, format, modelInfo, state) {
    const fileName = path.basename(filePath);
    const baseName = path.parse(fileName).name;
    
    log.info(`[${modelInfo.suffix}] Обработка: ${fileName}`);
    
    const duration = await getAudioDuration(filePath);
    log.info(`[${modelInfo.suffix}] Длительность: ${Math.floor(duration / 60)}м ${Math.floor(duration % 60)}с`);
    
    let result;
    
    // Короткие файлы — целиком
    if (duration <= CONFIG.chunkDuration) {
        log.info(`[${modelInfo.suffix}] Файл короткий, транскрибирую целиком`);
        
        for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
            try {
                const r = await transcribeFile(filePath, format, modelInfo.id);
                log.success(`[${modelInfo.suffix}] Готово за ${r.elapsed}с`);
                result = r.result;
                break;
            } catch (error) {
                if (attempt < CONFIG.maxRetries) {
                    log.warn(`[${modelInfo.suffix}] Попытка ${attempt}/${CONFIG.maxRetries}: ${error.message}`);
                    await sleep(2000 * attempt);
                } else throw error;
            }
        }
    } else {
        // Длинные файлы — с разбиением и перекрытием
        log.info(`[${modelInfo.suffix}] Разбиваю на части по ${CONFIG.chunkDuration / 60} мин (перекрытие ${CONFIG.overlapDuration}с)`);
        await fs.mkdir(CONFIG.tempDir, { recursive: true });
        
        const chunks = await splitAudio(filePath, CONFIG.tempDir, baseName, format);
        log.info(`[${modelInfo.suffix}] Получено частей: ${chunks.length}`);
        
        const transcripts = [];
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            log.info(`[${modelInfo.suffix}] Часть ${i + 1}/${chunks.length}: ${Math.floor(chunk.startTime / 60)}:${String(Math.floor(chunk.startTime % 60)).padStart(2, '0')} — ${Math.floor(chunk.endTime / 60)}:${String(Math.floor(chunk.endTime % 60)).padStart(2, '0')}`);
            
            let success = false;
            for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
                try {
                    const r = await transcribeFile(chunk.file, format, modelInfo.id);
                    log.success(`[${modelInfo.suffix}] Часть ${i + 1} готова за ${r.elapsed}с`);
                    transcripts.push({
                        startTime: chunk.startTime,
                        endTime: chunk.endTime,
                        text: r.result.text || r.result.transcription || ''
                    });
                    success = true;
                    break;
                } catch (error) {
                    if (attempt < CONFIG.maxRetries) {
                        log.warn(`[${modelInfo.suffix}] Попытка ${attempt}/${CONFIG.maxRetries}: ${error.message}`);
                        await sleep(2000 * attempt);
                    } else {
                        log.error(`[${modelInfo.suffix}] Часть ${i + 1} провалена: ${error.message}`);
                        transcripts.push({
                            startTime: chunk.startTime,
                            endTime: chunk.endTime,
                            text: `[ОШИБКА: ${error.message}]`
                        });
                    }
                }
            }
            
            if (i < chunks.length - 1) await sleep(CONFIG.delayBetweenRequests);
        }
        
        // Склеиваем с временными метками
        const fullText = transcripts
            .map(t => `[${Math.floor(t.startTime / 60)}:${String(Math.floor(t.startTime % 60)).padStart(2, '0')} - ${Math.floor(t.endTime / 60)}:${String(Math.floor(t.endTime % 60)).padStart(2, '0')}]\n${t.text}`)
            .join('\n\n');
        
        result = { text: fullText };
        
        // Чистим временные файлы
        for (const chunk of chunks) {
            try { await fs.unlink(chunk.file); } catch {}
        }
    }
    
    return result;
}

// ===== ГЛАВНАЯ =====
async function main() {
    if (!CONFIG.apiKey) {
        log.error('Не задан ROUTERAI_API_KEY');
        process.exit(1);
    }

    console.log(`\n${c.bright}${icons.mic} Двойная транскрибация аудио${c.reset}`);
    log.info(`Модели:`);
    CONFIG.models.forEach(m => log.info(`  - ${m.id} (${m.price} ₽/мин)`));
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

    // Считаем общее количество задач (файл × модель)
    const totalTasks = audioFiles.length * CONFIG.models.length;
    const doneTasks = state.processed.length;
    const pendingTasks = totalTasks - doneTasks;
    
    log.info(`Файлов: ${audioFiles.length} | Моделей: ${CONFIG.models.length} | Всего задач: ${totalTasks}`);
    log.info(`Выполнено: ${doneTasks} | Осталось: ${pendingTasks}\n`);

    if (pendingTasks === 0) {
        log.success('Все файлы уже обработаны!');
        return;
    }

    const startTime = Date.now();
    let success = 0, failed = 0;
    let taskNum = doneTasks;

    for (const file of audioFiles) {
        for (const model of CONFIG.models) {
            taskNum++;
            
            // Пропускаем уже обработанные
            if (isProcessed(state, file.name, model.id)) {
                log.info(`[${taskNum}/${totalTasks}] Пропуск: ${file.name} (${model.suffix}) — уже готово`);
                continue;
            }
            
            log.info(`\n[${c.bright}${taskNum}/${totalTasks}${c.reset}] ${file.name} → ${model.suffix}`);
            
            try {
                const result = await processAudioFile(file.path, file.format, model, state);
                
                const baseName = path.parse(file.name).name;
                const outName = `${baseName}_${model.suffix}.txt`;
                const outPath = path.join(CONFIG.outputDir, outName);
                const text = result.text || result.transcription || JSON.stringify(result, null, 2);
                await fs.writeFile(outPath, text, 'utf-8');
                
                state.processed.push({ file: file.name, model: model.id, time: new Date().toISOString() });
                await saveState(state);
                success++;
                
                log.success(`Сохранено: ${outName}\n`);
                
                await sleep(CONFIG.delayBetweenRequests);
            } catch (error) {
                state.failed.push({ 
                    file: file.name, 
                    model: model.id, 
                    error: error.message, 
                    time: new Date().toISOString() 
                });
                await saveState(state);
                failed++;
                log.error(`${file.name} (${model.suffix}): ${error.message}\n`);
            }
        }
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n${c.bright}${icons.chart} Итого:${c.reset}`);
    log.success(`Успешно: ${success}`);
    if (failed > 0) log.error(`С ошибками: ${failed}`);
    log.info(`Время: ${formatTime(totalTime)}`);
    
    // Примерная стоимость
    const totalMinutes = audioFiles.length > 0 
        ? (await Promise.all(audioFiles.map(f => getAudioDuration(f.path).catch(() => 0))))
            .reduce((sum, d) => sum + d / 60, 0)
        : 0;
    const pricePerModel = CONFIG.models.reduce((sum, m) => sum + m.price, 0);
    const estimatedCost = (totalMinutes * pricePerModel).toFixed(2);
    log.info(`Примерная стоимость: ${estimatedCost} ₽ (${totalMinutes.toFixed(0)} мин × ${pricePerModel} ₽)`);
    
    if (state.failed.length > 0) {
        console.log(`\n${c.yellow}${icons.warn} История ошибок:${c.reset}`);
        state.failed.slice(-10).forEach(f => log.error(`${f.file} [${f.model}]: ${f.error}`));
    }
    console.log();
}

main().catch(err => {
    log.error(`Критическая ошибка: ${err.message}`);
    process.exit(1);
});