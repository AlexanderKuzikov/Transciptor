<p align="center">
  <a href="https://nodejs.org/"><img alt="Node 24" src="https://img.shields.io/badge/Node-24+-339933?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
</p>

<h1 align="center">Transciptor</h1>
<p align="center">Batch-транскрипция аудио через RouterAI (Whisper-compatible)</p>

---

Zero-dependency утилиты для пакетной транскрипции аудио. Node 24 native fetch, RouterAI Audio Transcriptions API. Несколько режимов: single file, dual-channel, split-by-duration.

- **Zero dependencies** — Node 24 native fetch
- **RouterAI API** — Whisper-compatible endpoint
- **Режимы** — single, dual-channel, split-by-duration
- **Тесты моделей** — Chirp, Qwen, Whisper

## Быстрый старт

```bash
git clone https://github.com/AlexanderKuzikov/Transciptor.git
cd Transciptor
# .env с API-ключом RouterAI

node transcribe.js         # один файл
node transcribe-dual.js    # двухканальная запись
node transcribe-split.js   # разбиение по длительности
```

## Документация

- [`docs/CONTEXT.md`](docs/CONTEXT.md) — состояние проекта
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — архитектурные решения

## Статус

**Работает** — batch-транскрипция, zero-dependency.

## Лицензия

[Apache-2.0](LICENSE) © Alexander Kuzikov
