// test-duration.js
import fs from 'fs/promises';

async function test() {
    const buffer = await fs.readFile('./audio/2-2442-2025 27.10.2025 10-00.m4a');
    // Грубая оценка: m4a обычно 64-128 kbps
    const durationSec = (buffer.length * 8) / (96 * 1000); // 96 kbps средняя
    const minutes = Math.floor(durationSec / 60);
    const seconds = Math.floor(durationSec % 60);
    console.log(`Примерная длительность: ${minutes}м ${seconds}с`);
}

test();