# Transciptor — Instructions for AI Agents

## Commands
- single: `node transcribe.js`
- dual: `node transcribe-dual.js`
- split: `node transcribe-split.js`

## Conventions
- Node.js ESM, zero dependencies
- Node >=24 (native fetch)
- RouterAI Audio Transcriptions API (Whisper-compatible)
- Скрипты для разных режимов: single, dual-channel, split-by-duration

## Structure
- `transcribe.js` — один файл
- `transcribe-dual.js` — двухканальная запись
- `transcribe-split.js` — разбиение по длительности
- `test-*.js` — тесты моделей (Chirp, Qwen, Whisper)

## Do NOT touch
- `.env` — API-ключи

## Documentation rules
- После работы — обнови docs/CONTEXT.md
- НЕ создавай новых файлов документации без разрешения
