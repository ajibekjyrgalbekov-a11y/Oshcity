# Сайт Osh City для клиентов

- `site/` — сам сайт (публикуется на GitHub Pages автоматически при каждом push).
- `site/js/config.js` — **цены за м², взнос, срок, номер WhatsApp, ваши блоки**: всё меняется здесь.
- `site/data/apartments.json` — свободные квартиры (обновляется каждое утро).
- `export/export.py` — выгрузка из базы dbbase.kutstroy.kg (`--login` — один раз войти в базу).
- `export/update.bat` — выгрузка + публикация; `export/install_task.bat` — запуск каждый день в 09:00.
- `google/` — скрипт для Google Таблицы (статистика и заявки) и инструкция.
- `tools/extract_layouts.py` — нарезка планировок из PDF (рамки в `tools/layout_jobs.json`).
- `tests/` — проверка расчётов: `node tests/calc.test.js`.
