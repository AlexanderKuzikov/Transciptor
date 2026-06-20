# Transciptor

[![License](https://img.shields.io/github/license/AlexanderKuzikov/Transciptor)](https://github.com/AlexanderKuzikov/Transciptor/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/AlexanderKuzikov/Transciptor)](https://github.com/AlexanderKuzikov/Transciptor/commits/main)
[![GitHub repo size](https://img.shields.io/github/repo-size/AlexanderKuzikov/Transciptor)](https://github.com/AlexanderKuzikov/Transciptor)
[![Node.js >=24](https://img.shields.io/badge/Node.js-%3E%3D24-blue)](https://nodejs.org/)
[![RouterAI](https://img.shields.io/badge/ASR-RouterAI-purple)](https://github.com/AlexanderKuzikov/Transciptor)

Node.js-утилиты для пакетной транскрибации аудио через RouterAI Audio Transcriptions API.

## Статус

```text
MVP / demo-ready, не production-complete
```

Проект уже умеет отправлять аудио в RouterAI, сохранять текстовые расшифровки, вести состояние обработанных файлов и обрабатывать длинные записи через разбиение на части. Для production ещё нужны CLI-обёртка, нормальные npm scripts, тесты, валидация конфигов и стабильная обработка ошибок/повторов.

## Что умеет

| Режим | Скрипт | Что делает |
|---|---|---|
| Пакетная транскрибация | `transcribe.js` | Берёт аудио из `INPUT_DIR`, отправляет в RouterAI, пишет `.txt` в `OUTPUT_DIR`, запоминает обработанные файлы. |
| Длинные файлы | `transcribe-split.js` | Через `ffprobe`/`ffmpeg` режет длинные записи на части по 5 минут с перекрытием 15 секунд и склеивает результат с таймкодами. |
| Сравнение моделей | `transcribe-dual.js` | Прогоняет один и тот же файл через две модели и сохраняет отдельные расшифровки. |
| Ручные smoke-тесты | `test-*.js` | Быстрые проверки конкретных моделей/форматов; требуют тестовое аудио в `./audio`. |

## Быстрый старт

### 1. Установить Node.js

Требуется Node.js `>=24.0.0`.

```bash
node --version
```

### 2. Подготовить `.env`

```bash
cp .env.example .env
```

Отредактировать `.env`:

```env
ROUTERAI_API_KEY=ваш_ключ_от_routerai
INPUT_DIR=./audio
OUTPUT_DIR=./output
```

Важно: `.env` не коммитить в Git.

### 3. Положить аудио в папку входа

По умолчанию:

```text
audio/
```

Поддерживаемые расширения: `.mp3`, `.mp4`, `.wav`, `.webm`, `.flac`, `.ogg`, `.m4a`.

### 4. Запустить транскрибацию

Пакетная обработка коротких/обычных файлов:

```bash
node --env-file=.env transcribe.js
```

Обработка с разбиением длинных файлов:

```bash
node --env-file=.env transcribe-split.js
```

Сравнение двух моделей:

```bash
node --env-file=.env transcribe-dual.js
```

Без цвета/эмодзи для логов:

```bash
node --env-file=.env --plain transcribe.js
```

## Что будет на выходе

Результаты сохраняются в `OUTPUT_DIR`, по умолчанию:

```text
output/
├── <имя_файла>.txt
├── <имя_файла>_parakeet.txt
└── <имя_файла>_whisper.txt
```

Состояние обработанных файлов хранится в:

```text
.transcribe-state.json
```

Оно игнорируется Git через `.gitignore`, но используется скриптами, чтобы не отправлять уже обработанные файлы повторно.

## Основные сущности

| Сущность | Назначение |
|---|---|
| `ROUTERAI_API_KEY` | Ключ RouterAI API. |
| `INPUT_DIR` | Папка с исходными аудиофайлами. |
| `OUTPUT_DIR` | Папка для `.txt`-результатов. |
| `.transcribe-state.json` | История успешных и ошибочных обработок. |
| `temp/` | Временные куски аудио для `transcribe-split.js` и `transcribe-dual.js`. |

## Модели

Основная модель в обычных скриптах:

```text
qwen/qwen3-asr-flash-2026-02-10
```

В двойной транскрибации используются:

```text
nvidia/parakeet-tdt-0.6b-v3
openai/whisper-large-v3
```

Модели заданы в коде. Пока нет внешнего конфига, поэтому для смены модели нужно править соответствующий `.js`-файл.

## Проверка состояния

Посмотреть изменения:

```bash
git status --short --branch
git diff -- README.md
```

Проверить Markdown на явные ошибки форматирования:

```bash
git diff --check
```

## Ограничения текущей версии

- Нет `npm scripts`; запуск идёт напрямую через `node --env-file=.env ...`.
- Нет CLI-парсера аргументов, кроме `--plain`.
- Нет unit/e2e-тестов.
- Для разбиения длинных файлов требуется установленный `ffmpeg` и `ffprobe`.
- Нет production-ready retry/backoff policy: повторы есть, но политика фиксированная.
- Нет нормального конфига: модель, URL API, chunk size и задержки захардкожены в скриптах.
- Нет защиты от случайной отправки чувствительных аудио во внешний API; используйте только на разрешённых данных.

## Следующие шаги

1. Добавить `package.json` scripts: `transcribe`, `transcribe:split`, `transcribe:dual`, `test:smoke`.
2. Вынести runtime-настройки в `config/config.jsonc`.
3. Добавить CLI-аргументы: `--input`, `--output`, `--model`, `--force`, `--no-state`.
4. Добавить валидацию `.env`, наличия `ffmpeg/ffprobe` и размера/формата файла до отправки.
5. Добавить golden set и тесты для короткого аудио.
6. Добавить README для каждого режима обработки.

## Структура репозитория

```text
Transciptor/
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── package.json
├── package-lock.json
├── structure.md
├── transcribe.js
├── transcribe-split.js
├── transcribe-dual.js
└── test-*.js
```

## License

Apache-2.0 — см. [`LICENSE`](LICENSE).
