import fs from 'fs/promises';

const models = [
    { name: 'Google Chirp 3', model: 'google/chirp-3', price: '1.53 ₽/мин' },
    { name: 'Microsoft MAI-Transcribe 1.5', model: 'microsoft/mai-transcribe-1.5', price: '0.57 ₽/мин' },
    { name: 'NVIDIA Parakeet TDT 0.6B v3', model: 'nvidia/parakeet-tdt-0.6b-v3', price: '0.14 ₽/мин' },
    { name: 'OpenAI Whisper Large V3', model: 'openai/whisper-large-v3', price: '0.14 ₽/мин' },
    { name: 'Mistral Voxtral Mini Transcribe', model: 'mistralai/voxtral-mini-transcribe', price: '0.29 ₽/мин' }
];

async function testModel(modelInfo) {
    const buffer = await fs.readFile('./audio/2-2442-2025 27.10.2025 10-00.m4a');
    const base64 = buffer.toString('base64');
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Тестирую: ${modelInfo.name} (${modelInfo.price})`);
    console.log('='.repeat(60));
    
    const start = Date.now();
    
    try {
        const response = await fetch('https://routerai.ru/api/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.ROUTERAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelInfo.model,
                input_audio: { data: base64, format: 'm4a' },
                language: 'ru'
            })
        });
        
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`Ответ: HTTP ${response.status} за ${elapsed}с\n`);
        
        const result = await response.json();
        
        // Пытаемся извлечь текст разными способами
        const text = result.text || result.transcription || result.transcript || 
                     (result.results && result.results[0] && result.results[0].alternatives && result.results[0].alternatives[0] && result.results[0].alternatives[0].transcript) ||
                     '';
        
        if (text) {
            console.log(`✓ Текст получен (${text.length} символов):`);
            console.log(text.substring(0, 500) + (text.length > 500 ? '...' : ''));
        } else {
            console.log('✗ Текст не найден. Полный ответ:');
            console.log(JSON.stringify(result, null, 2));
        }
        
    } catch (error) {
        console.error(`✗ Ошибка: ${error.message}`);
    }
}

async function main() {
    console.log('Тестирование моделей транскрибации\n');
    console.log(`Файл: 2-2442-2025 27.10.2025 10-00.m4a (8м 41с)`);
    
    for (const model of models) {
        await testModel(model);
        console.log('\nОжидание 3 секунды...\n');
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Тестирование завершено');
    console.log('='.repeat(60));
}

main();