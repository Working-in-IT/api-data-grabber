# API Data Grabber — Chrome DevTools Extension

Chrome-расширение, которое перехватывает все fetch/XHR запросы из вкладки Network и позволяет просматривать JSON-ответы API в табличном виде через DataTables.

## Установка

1. Открыть `chrome://extensions`
2. Включить **Developer mode** (переключатель справа вверху)
3. Нажать **Load unpacked** и выбрать папку проекта
4. Открыть DevTools (F12) на любом сайте — появится вкладка **API Data Grabber**

## Структура проекта

```
browser-addon/
├── manifest.json            # Manifest V3, точка входа расширения
├── devtools.html            # Загружается при открытии DevTools
├── devtools.js              # Создаёт панель через chrome.devtools.panels.create()
├── panel.html               # Разметка панели (split-pane layout, табы)
├── panel.js                 # Вся логика: перехват, рендеринг, DataTables
├── panel.css                # Стили, тёмная тема
├── lib/
│   ├── jquery.min.js        # jQuery 3.7.1
│   ├── datatables.min.js    # DataTables 2.2.2
│   └── datatables.min.css   # Стили DataTables
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Архитектура

### Тип расширения

DevTools Extension (Manifest V3). Расширение не использует service worker, content scripts или дополнительные permissions. Всё работает внутри панели DevTools.

### Цепочка загрузки

```
Chrome открывает DevTools
  → загружает devtools.html (объявлен в manifest.json как devtools_page)
    → devtools.js вызывает chrome.devtools.panels.create()
      → Chrome рендерит panel.html как вкладку в DevTools
        → panel.js подписывается на chrome.devtools.network.onRequestFinished
```

### Перехват запросов (panel.js)

- **`chrome.devtools.network.onRequestFinished`** — слушатель, который получает HAR Entry для каждого завершённого запроса. Сохраняет метаданные (method, url, status, time, mimeType, headers) в массив `capturedRequests`.
- **Ленивая загрузка тела ответа** — `request.getContent(callback)` вызывается только при клике на запрос, а не при перехвате. Это экономит память.
- **`chrome.devtools.network.onNavigated`** — очищает список при переходе на новую страницу.
- **Лимит запросов** — `MAX_REQUESTS = 1000`. При превышении старые записи удаляются.

### UI панели

Панель разделена на две части через flexbox с перетаскиваемым разделителем:

- **Левая панель (40%)** — таблица запросов: Method, URL (сокращённый до pathname), Status (цветовая кодировка), Time (ms). Клик выделяет запрос.
- **Правая панель (60%)** — три вкладки:
  - **Response** — pretty-printed JSON с подсветкой синтаксиса (ключи, строки, числа, boolean, null)
  - **Headers** — заголовки запроса и ответа
  - **Table** — DataTables для массивов объектов (появляется синяя точка-индикатор на вкладке при обнаружении массивов)

### Обнаружение массивов (`detectArrays`)

Рекурсивный обход JSON-структуры (глубина до 10 уровней). Критерии обнаружения:
- Значение является `Array`
- Длина массива > 0
- Первый элемент — объект (не null, не массив)

Для каждого найденного массива запоминается dot-path (например `data.users`) и сам массив. В UI отображаются кнопки-чипы для переключения между массивами.

### DataTables

- Библиотеки **bundled локально** (CDN запрещён в Manifest V3)
- Колонки строятся динамически — union всех ключей из всех объектов массива
- Вложенные объекты/массивы в ячейках отображаются как `JSON.stringify`
- `defaultContent: ""` для отсутствующих ключей в гетерогенных массивах
- `scrollX: true` для широких таблиц, `scrollY: "400px"` для фиксированной высоты
- Перед повторной инициализацией всегда вызывается `.destroy()`

## Ключевые функции в panel.js

| Функция | Описание |
|---------|----------|
| `addRequestRow(entry)` | Добавляет строку в таблицу запросов с фильтрацией |
| `selectRequest(id)` | Выделяет запрос, загружает и отображает ответ |
| `loadAndShowResponse(entry)` | Ленивая загрузка тела через `getContent()` |
| `displayResponse(entry)` | Парсит JSON, рендерит viewer, запускает detectArrays |
| `renderJson(data, indent)` | Рекурсивный рендеринг JSON в HTML с подсветкой |
| `detectArrays(obj, path, depth)` | Рекурсивный поиск массивов объектов |
| `renderDataTable(arrayData)` | Инициализация DataTables для массива |
| `showHeaders(entry)` | Отображение заголовков запроса/ответа |
| `matchesFilter(entry)` | Проверка соответствия фильтру типа и поиску по URL |
| `rebuildRequestList()` | Перерисовка списка запросов (при смене фильтра) |
| `escapeHtml(str)` | Экранирование HTML-спецсимволов |
| `shortenUrl(url)` | Сокращение URL до pathname + search |
| `isJsonMime(mime)` | Проверка MIME-типа на JSON |

## Обработка краевых случаев

| Ситуация | Решение |
|----------|---------|
| Не-JSON ответ | Проверка `mimeType` через `isJsonMime()`. Показ raw text, вкладка Table неактивна |
| Base64-encoded ответ | Проверка параметра `encoding` в `getContent()`, декодирование через `atob()` |
| Ответ > 1 MB | Предупреждение `size-warning` перед рендерингом |
| Гетерогенный массив | Union ключей всех объектов, `defaultContent: ""` для пропусков |
| Вложенные объекты в ячейках | `JSON.stringify` обёрнутый в `<code>` |
| Переход на новую страницу | `onNavigated` очищает всё состояние |
| Переполнение памяти | Лимит 1000 запросов, FIFO при превышении |

## Зависимости

| Библиотека | Версия | Размер | Назначение |
|------------|--------|--------|------------|
| jQuery | 3.7.1 | 87 KB | Зависимость DataTables |
| DataTables | 2.2.2 | 96 KB JS + 27 KB CSS | Табличное отображение с сортировкой, поиском, пагинацией |
| DataTables Buttons | 3.2.2 | 28 KB JS + 13 KB CSS | Расширение для кнопок экспорта |
| Buttons HTML5 | 3.2.2 | 26 KB | Плагин экспорта в Excel/CSV |
| JSZip | 3.10.1 | 98 KB | Генерация xlsx-файлов (зависимость Buttons) |

Обновление: скачать новые версии с https://jquery.com/download/ и https://datatables.net/download/, заменить файлы в `lib/`.

## Chrome API

Расширение использует только API, доступные в контексте DevTools:

- **`chrome.devtools.panels.create(title, icon, page)`** — создание вкладки в DevTools
- **`chrome.devtools.network.onRequestFinished`** — событие завершения сетевого запроса, возвращает HAR Entry
- **`chrome.devtools.network.onNavigated`** — событие навигации страницы
- **`harEntry.getContent(callback)`** — получение тела ответа (string + encoding)
- **`harEntry._resourceType`** — тип ресурса (`"xhr"`, `"fetch"`, `"script"`, etc.)

Документация: https://developer.chrome.com/docs/extensions/reference/api/devtools/network

## Стилизация

- Цветовая кодировка HTTP-методов: GET (зелёный), POST (синий), PUT (оранжевый), PATCH (фиолетовый), DELETE (красный)
- Цветовая кодировка статусов: 2xx (зелёный), 3xx (оранжевый), 4xx (красный), 5xx (фиолетовый)
- JSON-подсветка: ключи (фиолетовый), строки (зелёный), числа (синий), null (серый)
- Тёмная тема через `@media (prefers-color-scheme: dark)` — автоматически подстраивается под настройки ОС
- Перетаскиваемый разделитель панелей (drag на `#divider`)
