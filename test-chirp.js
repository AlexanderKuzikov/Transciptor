import fs from 'fs/promises';

async function test() {
    const buffer = await fs.readFile('./audio/2-2442-2025 27.10.2025 10-00.m4a');
    const base64 = buffer.toString('base64');
    
    console.log('Тестирую Google Chirp 3...');
    const start = Date.now();
    
    try {
        const response = await fetch('https://routerai.ru/api/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.ROUTERAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'google/chirp-3',
                input_audio: { data: base64, format: 'm4a' },
                language: 'ru'
            })
        });
        
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`Ответ: HTTP ${response.status} за ${elapsed}с\n`);
        
        const result = await response.json();
        console.log('Полный ответ:');
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error(`Ошибка: ${error.message}`);
    }
}

test();