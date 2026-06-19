import fs from 'fs/promises';

async function test() {
    const filePath = './audio/2-2442-2025 27.10.2025 10-00.m4a';
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    
    console.log(`Оригинал: ${(buffer.length / 1024 / 1024).toFixed(2)} МБ`);
    console.log(`Base64: ${(base64.length / 1024 / 1024).toFixed(2)} МБ`);
    console.log(`JSON body: ~${((base64.length + 200) / 1024 / 1024).toFixed(2)} МБ`);
    
    // Тестовый запрос без аудио — просто проверить соединение
    try {
        const response = await fetch('https://routerai.ru/api/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.ROUTERAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3-asr-flash-2026-02-10',
                input_audio: { data: '', format: 'm4a' },
                language: 'ru'
            })
        });
        console.log(`\nТест соединения: HTTP ${response.status}`);
        console.log(`Ответ: ${await response.text()}`);
    } catch (error) {
        console.error(`\nОшибка соединения: ${error.message}`);
        if (error.cause) console.error(`Причина: ${error.cause}`);
    }
}

test();