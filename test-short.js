// test-short.js
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function test() {
    // Создаём короткий тестовый файл (3 секунды тишины)
    const testFile = './test-short.wav';
    await execAsync(`ffmpeg -y -f lavfi -i anullsrc=r=16000:cl=mono -t 3 "${testFile}"`);
    
    console.log('Тестовый файл создан (3 секунды)');
    
    const buffer = await fs.readFile(testFile);
    const base64 = buffer.toString('base64');
    
    console.log(`Отправляю запрос...`);
    const startTime = Date.now();
    
    try {
        const response = await fetch('https://routerai.ru/api/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.ROUTERAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3-asr-flash-2026-02-10',
                input_audio: { data: base64, format: 'wav' },
                language: 'ru'
            })
        });
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\nОтвет: HTTP ${response.status} за ${elapsed}с`);
        console.log(`Тело: ${await response.text()}`);
        
        // Удаляем тестовый файл
        await fs.unlink(testFile);
        
    } catch (error) {
        console.error(`Ошибка: ${error.message}`);
    }
}

test();