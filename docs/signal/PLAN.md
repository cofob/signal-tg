# План: перевод Telegram Web A на Signal

Статус: черновик для согласования, 2026-11-20.

Цель: веб-клиент на кодовой базе Telegram Web A (Teact, `src/global`, компоненты), который работает как связанное устройство Signal (как Signal Desktop) и поддерживает функции Signal, доступные связанному устройству. Функции Telegram без аналога в Signal удаляются. Эталон поведения: Signal Android; Signal Desktop: эталон того, что умеет связанное устройство, и единственный TypeScript-клиент Signal.

## 1. Факты, которые определяют архитектуру

Проверено по исходникам (клоны Signal-Android, Signal-Desktop, signal-cli от 2026-11-20):

1. Браузер не может работать с протоколом Signal напрямую. libsignal даёт привязки для Java, Swift и Node (нативный аддон `@signalapp/libsignal-client@0.108.3`), сборки для браузера нет. Сетевая часть libsignal (CDSI, SVR, chat websocket) использует свой TLS и Noise. Сервер Signal не отдаёт CORS-заголовки для чужих origin. Нужен серверный компонент, который держит ключи.
2. Протокольный слой Signal Desktop (`ts/textsecure/`) занимает 22 209 строк, плюс `ts/groups.preload.ts`, storage service и импорт бэкапов. Порт на Node займёт месяцы.
3. signal-cli 0.14.10 (2026-11-07, GPLv3) построен на `signal-service-java` (форк `lib/libsignal-service` из Signal Android) и уже умеет: привязку как связанное устройство по QR (`startLink`/`finishLink`), отправку и приём, группы v2 (админы, права, бан, ссылки-приглашения, метки участников, `terminateGroup`), реакции, редактирование, удаление для всех, админское удаление, опросы (`sendPollCreate/Vote/Terminate`), закрепление сообщений (`sendPinMessage`/`sendUnpinMessage`), истории (`sendStory`, приём текстовых и медиа-историй), стикерпаки, квитанции, индикатор набора, профиль, юзернейм, контакты, safety numbers (`listIdentities`, `trust`), список устройств, настройки приватности (`updateConfiguration`, `updateAccount`), экспериментальные голосовые звонки. Режим демона: `POST /api/v1/rpc` (JSON-RPC), `GET /api/v1/events` (SSE, буфер 1000 событий, `Last-Event-ID`).
4. signal-cli не хранит историю сообщений: он отдаёт события. Telegram Web A ждёт серверную историю с пагинацией. Историю хранит наш шлюз.
5. Связанное устройство не получает сообщения, отправленные до привязки. Signal Android передаёт историю через эфемерный бэкап (`ProvisionMessage.ephemeralBackupKey`, формат `lib/archive/.../Backup.proto`), Desktop это поддерживает (`ts/services/backups`), signal-cli нет.
6. Пробелы signal-cli, проверенные в коде:
   - JSON-события синхронизации содержат только `sentMessage`, `sentStoryMessage`, `blockedNumbers`, `blockedGroupIds`, `readMessages`, `type` (`JsonSyncMessage.java`). Внутренняя модель (`MessageEnvelope.Sync`) уже имеет `viewed`, `viewOnceOpen`, `messageRequestResponse`, но не отдаёт их. `deleteForMe`, `callEvent`, `callLinkUpdate` нет и во внутренней модели.
   - Нет команд для архива, закрепления, mute и «непрочитанного» у чатов (записи storage service); `pinnedConversations` только читается в `AccountRecordProcessor.java`. Нет папок чатов.
   - Звонки: только голос, процесс `signal-call-tunnel` на каждый звонок, звук идёт через виртуальные аудиоустройства на хосте (`docs/CALL_TUNNEL.md`). Видео и групповых звонков нет.
7. Порядок и идентификаторы в Signal Android: сообщения в чате сортируются по `DATE_RECEIVED` (`MessageTable.getConversation`), получатели и группы адресуются локальным числовым `RecipientId` (`core/util/.../RecipientId.kt`), правки хранятся отдельными ревизиями (`LATEST_REVISION_ID`).
8. Telegram Web A завязан на числовые id: `isUserId` проверяет префикс `-`, `isChannelId` и `getRawPeerId` разбирают id через `BigInt` (`src/util/entities/ids.ts`), `parseMessageKey` ждёт `-?\d+` (`src/util/keys/messageKey.ts`), локальные сообщения имеют дробный id (`isLocalMessageId`).
9. Signal Desktop записывает голосовые в MP3 (`ts/workers/mp3Encoder.std.ts`), Telegram Web A в OGG/Opus (`opus-recorder`). Совместимость OGG/Opus с Signal iOS не проверена.

## 2. Архитектура

```
Браузер (PWA)
  UI: src/components, src/global          сохраняем, вычищаем Telegram-функции
  src/api/signal/                          новый транспорт вместо src/api/gramjs
      callApi(name, ...args) -> POST /api/call
      ApiUpdate             <- GET  /api/events (SSE, resume по Last-Event-ID)
      медиа                 <- GET  /media/:id (Range), PUT /api/upload/:id
        |
        | HTTPS, один origin, cookie-сессия
        v
gateway/ (Node 24, TypeScript, тот же package.json)
  auth           пароль из env -> HttpOnly SameSite=Strict cookie
  store          node:sqlite: recipients, conversations, messages, revisions,
                 reactions, receipts, polls, pins, attachments, update_log, FTS5
  sync           события signal-cli -> записи БД -> ApiUpdate в update_log
  methods        реализации Methods, возвращают типы из src/api/types
  services       таймеры исчезающих сообщений, превью ссылок, web push
        |
        | JSON-RPC + SSE по localhost
        v
signal-cli daemon (форк с патчами, JVM 21 или GraalVM native)
  ключи, сессии, sender keys, группы v2, storage service, CDSI, вложения
        |
        v
Серверы Signal (chat, CDN, storage, CDSI, SVR)
```

Решения:

- Протокол держит signal-cli. Наш код живёт в TypeScript. Недостающие возможности добавляем патчами в форк signal-cli, каждый патч отдельным коммитом, пригодным для PR в AsamK/signal-cli.
- Шлюз возвращает объекты типов `src/api/types` (`ApiChat`, `ApiUser`, `ApiMessage`, `ApiUpdate`). Шлюз и клиент компилируются одним `tsc`, поэтому смена типа сразу ломает обе стороны. `src/api/signal/` остаётся тонким транспортом, логика маппинга живёт в одном месте.
- Новых npm-зависимостей нет: `node:http`, `node:sqlite` (FTS5 работает, проверено на Node 22), встроенный `fetch`, `parse5`/`linkedom` из текущих зависимостей для превью ссылок, `node:crypto` для VAPID. SSE вместо WebSocket, потому что в Node нет встроенного WebSocket-сервера.
- Идентификаторы как в Signal Android: шлюз выдаёт локальные числовые id. Пользователь: положительное целое, группа: отрицательное целое. ACI, PNI, номер и groupId хранятся полями. `isUserId`, `BigInt`-разбор и ключи сообщений продолжают работать.
- Сообщения нумеруются целыми числами внутри чата в порядке получения, как `DATE_RECEIVED` в Android. Identity сообщения в Signal: `(чат, ACI автора, sentTimestamp)`, уникальный индекс. Цитаты, реакции, правки, удаления, квитанции, голоса в опросах и закрепления находят сообщение по этому ключу.
- Надёжность доставки: signal-cli запускается с `--receive-mode=manual`, шлюз подписывается через `subscribeReceive`. Пока шлюз не подписан, сообщения остаются на сервере Signal. Каждое изменение пишется в `update_log` с монотонным `seq`, SSE отдаёт `seq` как event id, клиент догоняет пропущенное после обрыва.
- Развёртывание: `docker-compose` с двумя сервисами (`signal-cli`, `gateway`) и общим томом для вложений. Шлюз раздаёт собранный фронтенд, поэтому CORS не нужен. Внешний HTTPS делает обратный прокси пользователя.
- Безопасность: шлюз хранит ключи и расшифрованную историю, поэтому его ставят на доверенный хост. Вход по паролю обязателен, signal-cli слушает только внутреннюю сеть compose.

Отклонённые варианты:

| Вариант | Почему нет |
| --- | --- |
| libsignal в браузере (WASM) | Официальной сборки нет, сетевой стек libsignal не работает в браузере |
| Свой движок на `@signalapp/libsignal-client` | Порт ~22k строк `ts/textsecure` плюс группы, storage, бэкапы; месяцы до первого сообщения |
| Шлюз на Java/Kotlin поверх `lib` signal-cli | Убирает JSON-RPC-прослойку, но выносит маппинг и хранилище из TypeScript. Запасной вариант, если патчей к signal-cli станет слишком много |

## 3. Модель данных шлюза

| Таблица | Содержимое |
| --- | --- |
| `recipients` | `id` (±целое), тип, ACI, PNI, номер, юзернейм, имена из профиля/контакта/ника, about, аватар, profile key есть/нет, blocked, hidden, message request state |
| `conversations` | `recipient_id`, last message id, unread, read inbox/outbox max id, expire timer и его версия, archived, pinned order, muted until, marked unread, draft |
| `messages` | `(conversation_id, id)`, author recipient, `sent_at`, `received_at`, `server_received_at`, тип (обычное, служебное, история), текст, body ranges (стили, упоминания), quote ref, sticker, view-once, expires in/start, remote deleted, latest revision, delivery state на получателя |
| `revisions` | старые версии отредактированных сообщений |
| `reactions` | `(message, author)` -> emoji, timestamp; одна реакция на пользователя |
| `receipts` | `(message, recipient)` -> delivered/read/viewed at |
| `polls`, `poll_votes` | вопрос, варианты, multiple choice, terminated; голоса по пользователям |
| `pins` | закреплённые сообщения чата и срок |
| `attachments` | cdn key, digest, mime, size, размеры, blurhash, флаги (voice, gif, borderless), путь к файлу, статус загрузки |
| `stories`, `story_views` | истории, получатели, ответы, просмотры |
| `update_log` | `seq`, сериализованный `ApiUpdate` |
| `messages_fts` | FTS5 по тексту для поиска |

## 4. API шлюза

- `POST /api/auth/login`, `POST /api/auth/logout`.
- `GET /api/state` -> `noAccount` | `linking` | `ready` (и данные текущего аккаунта).
- `POST /api/link/start` -> `sgnl://linkdevice?...` для QR; `POST /api/link/finish` с именем устройства.
- `POST /api/call` `{ method, args }` -> результат метода. Имена и сигнатуры совпадают с `Methods` клиента: `fetchChats`, `fetchMessages`, `sendMessage`, `editMessage`, `deleteMessages`, `sendReaction`, `markMessageListRead` и т. д.
- `GET /api/events` -> SSE с `ApiUpdate`, id события = `seq`.
- `GET /media/:attachmentId` с `Range`; `GET /media/avatar/:recipientId`.
- `PUT /api/upload/:uploadId` сырым телом, без multipart.

## 5. Этапы

Этапы 1 и 2 идут параллельно: этап 1 меняет `src/components` и `src/global`, этап 2 добавляет `gateway/` и `src/api/signal/`.

### Этап 0. Каркас и проверка гипотез

- Форк signal-cli подключается подмодулем `engine/signal-cli`, собирается в Docker.
- `docker-compose.yml`: signal-cli в режиме `daemon --http --receive-mode=manual` + шлюз.
- Шлюз: HTTP-сервер, вход по паролю, схема SQLite с миграциями, JSON-RPC-клиент и SSE-потребитель signal-cli с переподключением, `update_log`.
- Проверка на тестовом аккаунте: привязка по QR, приём и отправка текста через `curl`.

Готово, когда: тестовый аккаунт привязан, входящее сообщение лежит в SQLite.

### Этап 1. Вырезать функции Telegram, пока бэкенд Telegram ещё работает

Удаляем по одной области за коммит, приложение остаётся рабочим на Telegram, поэтому регрессии видны в браузере. Внутри области удаляем компоненты, действия, редьюсеры, селекторы, методы `src/api/gramjs/methods`, типы `src/api/types`, ключи локализации, пункты реестра поиска настроек и горячих клавиш. Список областей: раздел 7.

Готово, когда: в UI нет функций из раздела 7, `npm run check:ts` и `npm run check:css` проходят.

### Этап 2. Транспорт Signal и MVP переписки

- `src/api/signal/`: `initApi`, `callApi`, `callApiLocal`, разбор SSE в `ApiUpdate`. Мастер-вкладка держит соединение, как сейчас.
- Экран входа: пароль шлюза, затем QR привязки (переиспользуем QR-экран входа Telegram), имя устройства.
- Список чатов: контакты и группы из signal-cli, порядок по последнему сообщению, счётчики непрочитанного, Note to Self вместо «Избранного».
- История с пагинацией из SQLite.
- Текст со стилями Signal (bold, italic, strikethrough, monospace, spoiler) и упоминаниями, ответы, пересылка, вложения (фото, видео, файлы, голосовые, GIF), стикеры, реакции, правка, удаление для всех и для себя, индикатор набора, квитанции доставки и прочтения, синхронизация прочтения с другими устройствами, исчезающие сообщения, view-once.
- Профили и аватары, служебные сообщения групп.

Готово, когда: переписка 1:1 и в группе работает в обе стороны с телефоном на Android, включая вложения, реакции, правки и удаление.

### Этап 3. Удалить GramJS

Удаляем `src/lib/gramjs`, `src/api/gramjs`, конфиг Telegram в `src/config.ts`, загрузку langpack с сервера Telegram, Telegram-ссылки (`t.me`, `tg://`) в пользу `signal.me`, `signal.group`, `sgnl://`. Локализация: файлы строк в сборке, языки по решению из раздела 9.

### Этап 4. Полный функционал Signal для связанного устройства

Каждый пункт: метод шлюза, при необходимости патч signal-cli, адаптация существующего UI Telegram Web A. Таблица соответствий: раздел 6.

### Этап 5. Звонки

Начинаем со спайка: signal-call-tunnel на шлюзе и мост звука в браузер через WebRTC или WebSocket. Видео и групповые звонки требуют RingRTC и SFU Signal; решение после спайка.

### Этап 6. Доводка

Брендинг, PWA и web push, документация развёртывания, миграция `dist/` и CI, проверка совместимости с актуальными версиями Signal Android, iOS, Desktop.
