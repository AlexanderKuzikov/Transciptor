// test-qwen-mp3.js
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function test() {
    const inputFile = './audio/2-2442-2025 27.10.2025 10-00.m4a';
    const mp3File = './temp/test.mp3';
    
    await fs.mkdir('./temp', { recursive: true });
    
    console.log('Конвертирую m4a → mp3...');
    await execAsync(`ffmpeg -y -i "${inputFile}" -acodec libmp3lame -q:a 4 "${mp3File}"`);
    
    const buffer = await fs.readFile(mp3File);
    const base64 = buffer.toString('base64');
    
    console.log(`MP3 готов: ${(buffer.length / 1024 / 1024).toFixed(2)} МБ`);
    console.log('Тестирую Qwen3 ASR Flash с mp3...\n');
    
    const start = Date.now();
    
    try {
        const response = await fetch('https://routerai.ru/api/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.ROUTERAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3-asr-flash-2026-02-10',
                input_audio: { data: base64, format: 'mp3' },
                language: 'ru'
            })
        });
        
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`Ответ: HTTP ${response.status} за ${elapsed}с\n`);
        
        const result = await response.json();
        const text = result.text || '';
        
        if (text && text.length > 0) {
            console.log(`✓ Qwen3 РАБОТАЕТ с mp3!`);
            console.log(`Текст (${text.length} символов):`);
            console.log(text.substring(0, 500) + (text.length > 500 ? '...' : ''));
        } else {
            console.log('✗ Qwen3 всё ещё не работает');
            console.log(JSON.stringify(result, null, 2));
        }
    } catch (error) {
        console.error(`Ошибка: ${error.message}`);
    }
    
    await fs.unlink(mp3File).catch(() => {});
}

test();