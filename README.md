# API Data Grabber — Chrome DevTools Extension

Chrome-расширение, которое перехватывает все fetch/XHR запросы и позволяет просматривать JSON-ответы API в табличном виде с возможностью скачивания в Excel/CSV.

## Установка

1. Скачать репозиторий: нажать зелёную кнопку **Code** → **Download ZIP**
2. Распаковать ZIP-архив в любую папку
3. Открыть в Chrome: `chrome://extensions`
4. Включить **Developer mode** (переключатель справа вверху)
5. Нажать **Load unpacked** и выбрать распакованную папку (ту, в которой лежит `manifest.json`)
6. Готово — расширение установлено

## Как пользоваться

### 1. Открыть панель

- Перейти на нужный сайт
- Открыть DevTools: **F12** (или правый клик → «Просмотреть код»)
- Перейти на вкладку **API Data Grabber** (последняя вкладка справа в DevTools)

### 2. Перехватить запросы

- Покликать по сайту или обновить страницу — запросы начнут появляться в списке слева
- По умолчанию отображаются только **XHR-запросы** (можно переключить на All или Fetch в дропдауне)
- Можно фильтровать по URL через поле поиска

### 3. Посмотреть ответ API

- Кликнуть на любой запрос в списке
- Вкладка **Response** — полный JSON-ответ с подсветкой синтаксиса
- Вкладка **Headers** — заголовки запроса и ответа

### 4. Получить данные в виде таблицы

- Перейти на вкладку **Table** (если на вкладке есть синяя точка — значит в ответе найдены массивы данных)
- Если массивов несколько — выбрать нужный кнопкой-чипом (например `data.users (25 items)`)
- Данные отобразятся в интерактивной таблице с сортировкой по колонкам, поиском и пагинацией

### 5. Скачать в Excel или CSV

- Над таблицей нажать **Export to Excel** или **Export to CSV**
- Файл скачается автоматически

## Возможности

- Перехват всех fetch/XHR запросов в реальном времени
- Фильтрация по типу (All / XHR / Fetch) и поиск по URL
- Просмотр JSON-ответов с подсветкой синтаксиса
- Просмотр заголовков запроса и ответа
- Автоматическое обнаружение массивов объектов в JSON (рекурсивно, до 10 уровней вложенности)
- Выбор нужного массива, если их несколько в одном ответе
- Табличное отображение с сортировкой, поиском и пагинацией
- Экспорт таблицы в Excel (.xlsx) и CSV
- Перетаскиваемый разделитель панелей
- Поддержка тёмной темы (автоматически подстраивается под настройки ОС)

## Для чего это полезно

- Быстро выгрузить данные из любого веб-приложения, где нет встроенного экспорта
- Получить сырые данные из внутренних инструментов без запросов к бэкенду
- Проверить что реально приходит в ответе API
- Сравнить данные между запросами

---

## Для разработчиков

<details>
<summary>Структура проекта</summary>

```
api-data-grabber/
├── manifest.json            # Manifest V3, точка входа расширения
├── devtools.html            # Загружается при открытии DevTools
├── devtools.js              # Создаёт панель через chrome.devtools.panels.create()
├── panel.html               # Разметка панели (split-pane layout, табы)
├── panel.js                 # Вся логика: перехват, рендеринг, DataTables
├── panel.css                # Стили, тёмная тема
├── lib/
│   ├── jquery.min.js        # jQuery 3.7.1
│   ├── datatables.min.js    # DataTables 2.2.2
│   ├── datatables.min.css
│   ├── dataTables.buttons.min.js   # DataTables Buttons 3.2.2
│   ├── buttons.dataTables.min.css
│   ├── buttons.html5.min.js
│   └── jszip.min.js         # JSZip 3.10.1
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

</details>

<details>
<summary>Архитектура</summary>

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

### Обнаружение массивов (`detectArrays`)

Рекурсивный обход JSON-структуры (глубина до 10 уровней). Критерии: значение является `Array`, длина > 0, первый элемент — объект (не null, не массив). Для каждого найденного массива запоминается dot-path (например `data.users`).

### DataTables

- Библиотеки **bundled локально** (CDN запрещён в Manifest V3)
- Колонки строятся динамически — union всех ключей из всех объектов массива
- Вложенные объекты/массивы в ячейках отображаются как `JSON.stringify`
- `defaultContent: ""` для отсутствующих ключей в гетерогенных массивах
- Перед повторной инициализацией всегда вызывается `.destroy()`

</details>

<details>
<summary>Ключевые функции в panel.js</summary>

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

</details>

<details>
<summary>Зависимости</summary>

| Библиотека | Версия | Размер | Назначение |
|------------|--------|--------|------------|
| jQuery | 3.7.1 | 87 KB | Зависимость DataTables |
| DataTables | 2.2.2 | 96 KB JS + 27 KB CSS | Табличное отображение с сортировкой, поиском, пагинацией |
| DataTables Buttons | 3.2.2 | 28 KB JS + 13 KB CSS | Расширение для кнопок экспорта |
| Buttons HTML5 | 3.2.2 | 26 KB | Плагин экспорта в Excel/CSV |
| JSZip | 3.10.1 | 98 KB | Генерация xlsx-файлов (зависимость Buttons) |

</details>

<details>
<summary>Chrome API</summary>

- **`chrome.devtools.panels.create(title, icon, page)`** — создание вкладки в DevTools
- **`chrome.devtools.network.onRequestFinished`** — событие завершения сетевого запроса, возвращает HAR Entry
- **`chrome.devtools.network.onNavigated`** — событие навигации страницы
- **`harEntry.getContent(callback)`** — получение тела ответа (string + encoding)
- **`harEntry._resourceType`** — тип ресурса (`"xhr"`, `"fetch"`, `"script"`, etc.)

Документация: https://developer.chrome.com/docs/extensions/reference/api/devtools/network

</details>
