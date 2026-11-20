# План: перевод Telegram Web A на Signal

Статус: согласован 2026-11-20, решения в разделе 9. Название продукта: TeleSignal.

Цель: веб-клиент на кодовой базе Telegram Web A (Teact, `src/global`, компоненты), который работает как связанное устройство Signal (как Signal Desktop) и поддерживает функции Signal, доступные связанному устройству. Вся клиентская логика и криптография выполняются в браузере: libsignal собирается в WebAssembly. Прокси нужен только для сетевого доступа к серверам Signal. Функции Telegram без аналога в Signal удаляются.

Эталоны: Signal Android задаёт поведение и лимиты; Signal Desktop показывает, что умеет связанное устройство, и служит главным источником кода для переноса, потому что написан на TypeScript.

## Ход работ

Этап 0, сделано (2026-11-20):

- `rust/libsignal/`: крейты libsignal v0.108.3; `rust/signal-wasm/`: WASM-мост протокола (имена функций как у `Native`) и TLS-клиент на rustls. Сборка: `npm run signal:wasm`, результат в `src/lib/signal/wasm/generated`.
- `proxy/tunnel.ts`: туннель WebSocket -> TCP, `npm run signal:proxy`.
- protobuf-es: `npm run signal:proto` (`buf generate`), схемы в `src/lib/signal/proto/schema`, код в `src/lib/signal/proto/generated`.
- `src/lib/signal/net`: TLS через туннель, HTTP/1.1, WebSocket, протокол `WebSocketResources`.
- `src/lib/signal/account`, `receiver`, `chat`, `store`, `sender`: привязка устройства, загрузка prekeys, чат-сокет, расшифровка конвертов, хранилище в IndexedDB, отправка с обработкой 409/410 и запросы синхронизации после привязки.

Этап 2, начат: движок умеет скачивать и расшифровывать вложения, разбирать синхронизацию контактов, читать storage service, получать профили и состояние групп v2 (zkgroup в WASM). Интеграции с UI (`src/api/signal`) пока нет.

Проверено: сессия PQXDH, zkgroup (на боевых параметрах сервера), вложения и расшифровка групп в Node; TLS и туннель до `chat.signal.org`; в Chromium через `npm run dev` сокет привязки выдаёт ссылку `sgnl://linkdevice`.

Не проверено: привязка телефоном и расшифровка первого сообщения. Проверка вручную:

1. `.env`: `SIGNAL_TUNNEL_URL=ws://localhost:8787/tunnel` и любые `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (сборка их пока требует).
2. `npm run signal:proxy` (Node 24) и `npm run dev`.
3. В консоли `localhost:1234`: `await signalDev.link()`, отсканировать QR в Signal на телефоне (Настройки > Связанные устройства).
4. Написать себе с другого аккаунта: расшифрованные сообщения печатаются в консоль. Другие команды: `signalDev.sendText('<ACI>', 'текст')`, `signalDev.syncStorage()` (записи storage service), `signalDev.groups()` (группы), `signalDev.profile()` (свой профиль), `signalDev.listen()` (переподключиться), `signalDev.reset()` (стереть локальные данные).

## 1. Проверенные факты

Источники: клоны Signal-Android, Signal-Desktop, libsignal, RingRTC (2026-11-20), проверки сборки и сети из этого окружения.

1. **libsignal собирается под `wasm32-unknown-unknown`** (`cargo check`, Rust 1.98.1 из `rust-toolchain` libsignal). Нужны только фича `wasm_js` у `getrandom` 0.2/0.3/0.4 и `protoc` для сборки `spqr`. Собираются крейты: `libsignal-core`, `signal-crypto`, `libsignal-protocol` (PQXDH, Double Ratchet, SPQR, sealed sender, sender keys), `zkgroup` (группы v2, учётные данные профиля), `usernames`, `libsignal-account-keys`, `libsignal-message-backup` (перенос истории).
2. **`attest` не собирается под wasm32**: он зависит от `boring-signal` (BoringSSL). BoringSSL используется для X.509, ECDSA P-256, BigNum и ASN.1 при проверке SGX DCAP (около 70 вызовов в 4205 строках `src/dcap*`, `src/cert_chain.rs`). `attest` нужен для CDSI (поиск пользователей по номеру телефона).
3. **В libsignal нет WASM-моста.** Мосты генерируются макросами `rust/bridge/shared/macros` (433 функции `bridge_fn`) для FFI, JNI и Node. Node-мост занимает 5788 строк (`rust/bridge/shared/types/src/node`). Обёртка `@signalapp/libsignal-client` на TypeScript (`node/ts`, 19 608 строк с тестами и `net`) обращается к нативному модулю только через объект `Native`.
4. **Все хосты Signal отдают сертификат частного CA «Signal Messenger, LLC»**: chat, storage, cdn, cdn2, cdn3, cdsi, sfu.voip (проверено `openssl s_client`). Браузер отвергнет такой TLS независимо от CORS. Desktop закрепляет этот CA (`config/default.json`, `certificateAuthority`). Значит, прокси обязателен.
5. **Звонки Signal несовместимы с WebRTC браузера.** RingRTC начиная с V3 отключает DTLS и задаёт ключи SRTP через собственный обмен Диффи-Хеллмана (`ringrtc/src/rust/src/core/connection.rs:773`, `signaling.rs:26`). WebRTC браузера требует DTLS-SRTP и не даёт задать ключи SRTP.
6. **Протокольный слой Signal Desktop** (`ts/textsecure/`) занимает 22 209 строк, импорт бэкапа (`ts/services/backups/import.preload.ts`) 4842 строки. Это основной код для переноса.
7. **Связанное устройство** получает при привязке `ProvisionMessage`: ключи ACI и PNI, profile key, `ephemeralBackupKey`, `accountEntropyPool`, `mediaRootBackupKey`. После привязки Desktop отправляет `PUT /v1/devices/link`, запрашивает синхронизацию CONTACTS, CONFIGURATION и BLOCKED, при наличии ключа скачивает архив истории (`v1/devices/transfer_archive`), затем синхронизирует storage service (`ts/background.preload.ts:1940-2000`). На запросы синхронизации отвечает только основное устройство.
8. **Только основное устройство** может: менять discoverability и атрибуты аккаунта, PIN и registration lock, ротировать profile key, менять номер, удалять аккаунт, управлять бэкапами и связанными устройствами (`util/assembleAccountAttributes.preload.ts:17` в Desktop).
9. **Порядок и идентификаторы в Signal Android:** сообщения сортируются по `DATE_RECEIVED` (`MessageTable.getConversation`), получатели адресуются локальным числовым `RecipientId` (`core/util/.../RecipientId.kt`), правки хранятся отдельными ревизиями (`LATEST_REVISION_ID`).
10. **Telegram Web A завязан на числовые id:**
    - `isUserId` проверяет префикс `-` (96 мест в 66 файлах); `isChannelId` и `getRawPeerId` разбирают id через `BigInt`.
    - Цвет аватара считается как `getPeerIdDividend(id) % 7`.
    - Ключ сообщения разбирается регуляркой `/^msg(-?\d+)-(\d+)/`.
    - `viewportIds`, `listedIds` и `lastReadInboxMessageId` являются `number[]` или `number`, сравниваются численно, история пагинируется по offsetId.
    - Локальные сообщения имеют дробный id.
11. **Объём GramJS и API Telegram:** `src/lib/gramjs` занимает 48,5 тыс. строк, `src/api/gramjs` 33,9 тыс. Наружу торчат около 574 методов, из `src/global` вызываются около 518. Объединение `ApiUpdate` содержит 150 типов. Транспортно-нейтральные типы `src/api/types` (6,4 тыс. строк) сохраняются.
12. Signal Desktop записывает голосовые в MP3 (`ts/workers/mp3Encoder.std.ts`), Telegram Web A в OGG/Opus (`opus-recorder`). Не проверено, воспроизводит ли Signal iOS OGG/Opus.

## 2. Архитектура

```
Браузер
  UI: src/components, src/global          сохраняем, вычищаем Telegram-функции
  src/api/signal/   (Worker мастер-вкладки, вместо src/api/gramjs)
      methods/      реализации Methods поверх локальной БД и движка
      updates/      входящие события -> ApiUpdate
  src/lib/signal/   (вместо src/lib/gramjs)
      wasm/         libsignal в WASM + TS-обёртка из libsignal/node/ts
      proto/        TS-кодеки, сгенерированные из .proto Signal Android
      net/          REST и WebSocket Signal (порт WebAPI, SocketManager, WebsocketResources)
      protocol/     приём и отправка (порт MessageReceiver, SendMessage, OutgoingMessage)
      provisioning/ groups/ storage/ cds/ attachments/ backups/ profiles/ stickers/
      store/        IndexedDB: ключи, сессии, prekeys, sender keys, получатели,
                    чаты, сообщения, необработанные конверты, вложения
        |
        | HTTPS + WSS на свой origin
        v
proxy/  (Node 24, без зависимостей, без состояния)
  WebSocket -> TCP туннель к хостам из allowlist, TLS не расшифровывает
        |
        v
Серверы Signal (chat, storage, cdn0/2/3, cdsi)
```

Решения:

- **Архитектура повторяет Telegram Web A.** GramJS живёт в Worker мастер-вкладки и отдаёт `ApiUpdate`; на его место встаёт движок Signal. Мастер-вкладка держит единственный WebSocket устройства, другие вкладки ходят через неё (`src/util/browser/multitab.ts`).
- **WASM-мост.** Нужные крейты libsignal v0.108.3 лежат в `rust/libsignal/` без изменений, кроме перечисленных в `rust/libsignal/NOTICE.md`. Собственный крейт `rust/signal-wasm/` (wasm-bindgen) экспортирует функции с именами и сигнатурами `Native` из `libsignal/node/ts/Native.ts`, только нужное подмножество. Движок вызывает их напрямую через `src/lib/signal/wasm`; обёртку `node/ts` переносить не стали: прямые вызовы короче, а совпадение имён с `Native` упрощает перенос кода Desktop. `libsignal-net` в сборку не входит: сеть написана на TypeScript поверх туннеля.
- **CDSI** требует патча `attest` в форке: BoringSSL заменяется чистым Rust (`x509-cert`, `p256`, `ecdsa`, `sha2`) за фичей. До патча поиск по номеру недоступен; контакты с телефона приходят с ACI через синхронизацию, поиск по юзернейму CDSI не нужен.
- **Protobuf:** [protobuf-es](https://github.com/bufbuild/protobuf-es) (`@bufbuild/protobuf`), код генерирует `buf generate` по `buf.gen.yaml` (`npm run signal:proto`). `.proto` копируются из Signal Android с указанием версии. 64-битные числа приходят как `bigint`, неизвестные поля сохраняются (нужно storage service).
- **Хранилище:** IndexedDB без новых зависимостей. Сырой конверт сначала сохраняется в `unprocessed`, потом подтверждается серверу (как в Desktop), поэтому сбой вкладки не теряет сообщения. Вызывается `navigator.storage.persist()`. При заданном код-пароле ключи и история шифруются (расширяем `src/util/passcode`).
- **Идентификаторы как в Signal Android:** движок выдаёт локальные числовые id. Пользователь: положительное целое, группа: отрицательное целое. ACI, PNI, номер и groupId хранятся полями. Сообщения нумеруются целыми числами внутри чата в порядке получения. Identity сообщения в Signal: `(чат, ACI автора, sentTimestamp)`, уникальный индекс. Цитаты, реакции, правки, удаления, квитанции, голоса и закрепления находят сообщение по нему. Правка сохраняет id и пишет ревизию. Так `isUserId`, ключи сообщений, viewport и пагинация работают без переписывания.
- **Лицензии:** libsignal и Signal Desktop распространяются под AGPLv3, Telegram Web A и Signal Android под GPLv3. GPLv3 §13 разрешает такое объединение; перенесённые и встроенные AGPL-части сохраняют свою лицензию. Исходники публичны, требование AGPL о раскрытии кода выполняется. Добавляем NOTICE с перечнем.

### Режим прокси

| | P1: HTTP/WS reverse proxy | P2: TCP-туннель, TLS в WASM |
| --- | --- | --- |
| Что делает прокси | Завершает TLS к Signal, проверяет закреплённый CA, добавляет CORS, переносит заголовки авторизации для WebSocket | Пересылает байты WebSocket в TCP-соединение с хостом из allowlist |
| Что видит прокси | Учётные данные устройства (`aci.deviceId:password`), пути запросов (чьи prekeys, какие вложения), зашифрованные E2E конверты | Только имена хостов и объём трафика |
| Работа в браузере | `fetch` и `WebSocket` | TLS (rustls) в WASM, свои клиенты HTTP/1.1 и WebSocket поверх него |
| Размер прокси | 200–300 строк | ~100 строк |
| Риск | Злоумышленный прокси может вызывать API от имени устройства, но не прочитает и не подделает сообщения без ключей | Сложнее, медленнее на больших вложениях |

Выбран P2. TLS делает rustls внутри `rust/signal-wasm` в sans-IO режиме: TypeScript передаёт байты между туннелем и TLS-сессией. Для хостов Signal доверяем только закреплённому CA Signal. Поверх TLS работают свои клиенты HTTP/1.1 и WebSocket, поэтому заголовки авторизации WebSocket задаём сами.

## 2a. Аккаунты без номера телефона

Signal позволяет аккаунты без номера: у них нет PNI и номера, собеседники находят их по юзернейму. Поддержка есть в выпущенной libsignal v0.108.3 (`AuthCredentialWithPniResponse::receive_without_pni`, поле `ProvisionMessage.authCredentialSalt`) и в Signal Desktop (capability `nopni2`, «e164-less linking», `ts/textsecure/Provisioner.preload.ts`, `ts/services/groupCredentialFetcher.preload.ts`). В main libsignal после v0.108.3 два коммита, к этому не относящихся.

Сделано:

- QR-ссылка объявляет `nopni` и `nopni2`.
- Привязка без PNI: требуется `authCredentialSalt`, PNI-ключи и `pniRegistrationId` не создаются, capability `optionalPhoneNumber` равна `true`; соль хранится в аккаунте.
- Групповые auth credentials без PNI: `ServerPublicParams_ReceiveAuthCredentialZkcWithoutPni` с солью, дальше та же zk-презентация.
- Конверты на PNI для такого аккаунта отклоняются, всё адресуется ACI.

Осталось (вместе с соответствующими функциями):

- Сертификат sealed sender запрашивать с `?includeE164=false` (`GET /v1/certificate/delivery`).
- При старте обновлять capabilities устройства с `optionalPhoneNumber`.
- Поиск собеседников по юзернейму (`usernames` в WASM, `GET /v1/accounts/username_hash`) как основной путь вместо CDSI.
- UI: не показывать и не требовать номер в профиле, настройках приватности и экранах привязки.

Не проверено на живом аккаунте без номера: нужен такой аккаунт на телефоне.

## 3. Соответствие функций

Колонка «Этап» ссылается на раздел 5.

| Функция Signal | Что используем в Telegram Web A | Этап |
| --- | --- | --- |
| Привязка по QR (provisioning, `PUT /v1/devices/link`, sync requests) | QR-экран входа `src/components/auth` | 2 |
| Чаты 1:1, группы v2, Note to Self | список чатов, «Избранное» -> Note to Self | 2 |
| Текст: bold, italic, strikethrough, monospace, spoiler; упоминания (UTF-16 offsets) | `ApiMessageEntity`, редактор (лишние стили убираем) | 2 |
| Длинный текст: inline ≤ 2 KiB, остальное во вложении `text/x-signal-plain` ≤ 64 KiB | — | 2 |
| Вложения: фото, видео, файлы, GIF, borderless, голосовые с waveform; blurhash; incremental MAC; ≤ 100 MiB | медиа-компоненты, `mediaViewer`, `VoiceRecordBar` | 2 |
| Ответы (quote), пересылка (флаг FORWARD, без автора) | `replyInfo`, пересылка | 2 |
| Реакции: одна на пользователя, любой emoji | `middle/message/reactions` с лимитом 1 | 2 |
| Правка: ≤ 1 дня, ≤ 10 правок, история правок | редактирование, новый просмотр истории | 2 |
| Удаление для всех (≤ 1 дня), для себя (sync `deleteForMe`), админское удаление | модалка удаления | 2 |
| Квитанции доставки, прочтения, просмотра; sealed sender | галочки, «Кто прочитал» -> детали сообщения | 2 |
| Индикатор набора (отправка каждые 10 с, стоп через 3 с, таймаут 15 с) | статус набора | 2 |
| Исчезающие сообщения с версией таймера | `modals/autoDeleteTimer`, ttl сообщения | 2 |
| View-once | `modals/oneTimeMedia` | 2 |
| Профили и аватары собеседников, служебные сообщения групп | профиль, `ApiMessageAction` | 2 |
| Медиагалерея чата | вкладки медиа в профиле | 2 |
| Перенос истории при привязке (link-and-sync, `libsignal-message-backup`) | — | 4 |
| Стикерпаки (webp/apng, packId+packKey), установка, синхронизация | `StickerPicker`; TGS и custom emoji удаляются | 4 |
| Превью ссылок, создаёт отправитель | превью веб-страниц | 4 |
| Shared contacts | `middle/message/Contact.tsx` | 4 |
| Опросы: 2–10 вариантов, multiple choice, завершение | `modals/poll`, `middle/message/poll` | 4 |
| Закреплённые сообщения: ≤ 3, на 24 ч, 7 д, 30 д или навсегда | панель закрепов | 4 |
| Группы v2: создание, название ≤ 32, описание ≤ 480, аватар, админы, права (attributes, members, addFromInviteLink, memberLabel), только админы пишут, бан, ссылка-приглашение с одобрением, приглашения, заявки, метки участников ≤ 24, завершение группы | `right/management` (общие части), `gili` | 4 |
| Профиль: имя 26+26, about 140 + emoji, аватар, бейджи (показ), ник и заметка о контакте | настройки профиля | 4 |
| Юзернейм (3–32 + дискриминатор), ссылка и QR, поиск по юзернейму | настройки юзернейма, `modals/qrCode` | 4 |
| Поиск по номеру (CDSI) | новый чат | 4, после патча `attest` |
| Safety numbers, смена ключа, key transparency | новый экран | 4 |
| Блокировка, запросы на переписку (accept, delete, block, spam) | блокировка, плашка запроса | 4 |
| Архив, закреп чатов (≤ 4), mute, «непрочитанное» через storage service | список чатов | 4 |
| Папки чатов (storage `ChatFolder`) | `left/settings/folders` без ссылок-приглашений | 4 |
| Настройки: квитанции, индикатор набора, превью ссылок, индикаторы sealed sender, таймер по умолчанию, видимость номера | настройки приватности | 4 |
| Поиск по сообщениям локально | поиск | 4 |
| Attachment backfill (запрос вложения у основного устройства) | — | 4 |
| Истории: медиа и текст, My Story, списки рассылки, групповые, ответы, просмотры | `components/story` | 5 |
| Профили уведомлений | — | 6 |
| История звонков (sync `callEvent`), уведомления о платежах и gift badges (только показ) | — | 6 |
| Цвета чатов | локальные темы и фоны Telegram Web A | 6 |
| GIF-поиск (Giphy, как в Desktop `util/giphy.std.ts`) | `GifPicker` | 6 |
| Несколько аккаунтов | `util/multiaccount.ts` | 6 |
| Звонки 1:1, групповые, call links | `components/calls` | R |

Не переносим, потому что это функции основного устройства: регистрация, PIN и registration lock, смена номера, удаление аккаунта, бэкапы, управление связанными устройствами, кошелёк MobileCoin, донаты.

## 4. Что вырезаем из Telegram Web A

| Область | Где | Объём |
| --- | --- | --- |
| Каналы, супергруппы, форумы, топики, монофорумы, сообщества | `left/main/forum`, `left/main/community`, `right/{Create,Edit}Topic`, Telegram-части `right/management`, `reducers` и `selectors/topics.ts`, методы `forum`, `communities`, `openedChannelShortpoll.ts` | «forum» встречается в 93 файлах |
| Боты, inline, клавиатуры, Mini Apps, attach-боты, создание ботов, виджеты | `actions/api/bots.ts`, composer `BotKeyboard`, `BotCommandMenu`, `AttachMenu`, `inlineResults`, `modals/browser`, `botCreation`, `attachBotInstall`, `urlAuth`, `requestPeer`, `preparedMessage`, `lib/widget-sandbox` | sandbox: 136 файлов, 20,8 тыс. строк |
| Premium, Stars, подарки, коллекционки, Fragment, розыгрыши, бусты | `main/premium`, `modals/stars`, `modals/gift`, `common/gift`, `right/gifts`, `collectible`, `giftcode`, `boost`, `src/limits.ts` | подарки: 98 файлов, 10,8 тыс. |
| Платежи, счета, кошелёк, TON, TonConnect | `components/payment`, `modals/wallet`, `lib/ton`, методы `wallet`, `tonConnect`, `payments` | кошелёк: 151 файл, 17,1 тыс. |
| Статистика | `right/statistics`, `lovely-chart` | 21 файл |
| Business, платные сообщения, медиа и реакции, реклама, эффекты сообщений | `BusinessHours`, `ContactGreeting`, quick replies, `common/paidMessage`, `modals/paidReaction`, `Sponsored*`, `MessageEffect.tsx` | |
| Перевод и AI | `reducers/translations.ts`, `actions/api/ai.ts`, `AiMessageEditorModal`, `modals/aiTonePreview` | Определение языка (`lib/fasttext`) нужно только переводу, решаем вместе с ним |
| Викторины, to-do списки | `middle/message/poll` (части), `TodoList` | Опросы остаются |
| Серверные отложенные сообщения Telegram | методы отложенных в `src/api/gramjs` | UI отложенных остаётся для локальных (раздел 9) |
| Сохранённые диалоги и теги «Избранного» | `fetchSavedChats`, `toggleSavedDialogPinned`, теги реакций | Note to Self остаётся |
| Shareable chatlists, custom emoji, emoji status, TGS-стикеры | `modals/chatlist`, `StatusPickerMenu`, `emojiStatusAccess`, `lib/tlottie` | |
| Instant View | `components/iv`, `InstantViewTab` | Используется в `MessageRichText`, отделяем при удалении |
| Музыкальный пикер, карты и геолокация | `modals/musicPicker`, `Location.tsx`, `modals/map`, `locationAccess` | Плеер аудио остаётся |
| Облачный пароль, passkeys, активные сессии и сайты | `left/settings/twoFa`, `modals/twoFaCheck`, `SettingsPasskeys`, `SettingsActiveSessions` | |
| Прочие модалки Telegram | `frozenAccount`, `ageVerification`, `cocoon`, `suggestMessage`, `suggestedPostApproval`, `rank`, `profileRating`, `birthday`, `aboutAds`, `reportAd` | |
| Серверные обои и темы чатов, langpack с сервера, ссылки `t.me` и `tg://` | `fetchWallpapers`, `fetchChatThemes`, `util/localization`, `deepLinkParser.ts`, `config.ts` | Заменяем на `signal.me`, `signal.group`, `sgnl://` |
| GramJS | `src/lib/gramjs`, `src/api/gramjs` | 82 тыс. строк, на этапе 3 |

Остаются: инфраструктура UI (`ui`, `gili`, `common`), медиаплеер и просмотрщик, код-пароль, мульти-вкладки, Service Worker (без push от Telegram), локализация (строки внутри сборки), локальные темы, Tauri (переименование отдельно).

## 5. Этапы

Этапы 0 и 1 идут параллельно: этап 0 пишет `src/lib/signal`, `proxy/` и форк libsignal, этап 1 удаляет код из `src/components`, `src/global` и `src/api/gramjs`.

### Этап 0. Спайки, снимающие риски

1. **libsignal в WASM.** Форк libsignal, цель `wasm` в макросах моста, сборка через wasm-bindgen, `node/ts` поверх WASM. Готово, когда в браузере две пары хранилищ проводят сессию PQXDH, шифруют и расшифровывают сообщение, sealed sender и sender key работают, размер `.wasm` измерен.
2. **Прокси-туннель и TLS в WASM.** Туннель WebSocket -> TCP с allowlist (chat, storage, cdn0/2/3, cdsi, contentproxy), rustls в WASM с закреплённым CA Signal, клиенты HTTP/1.1 и WebSocket на TypeScript. Готово, когда браузер открывает `wss://chat.signal.org/v1/websocket/provisioning/` через туннель.
3. **Protobuf** (`npm run signal:proto`): `SignalService`, `Provisioning`, `WebSocketResources`, `Groups`, `DecryptedGroups`, `StorageService`, `Backup`.
4. **Привязка и первое сообщение.** QR в браузере, скан с Android, расшифровка `ProvisionMessage`, `PUT /v1/devices/link`, загрузка prekeys, WebSocket, расшифровка входящего конверта. Готово, когда текст с телефона виден в консоли.

### Этап 1. Вырезать функции Telegram, пока бэкенд Telegram ещё работает

Удаляем по одной области за коммит из раздела 4: компоненты, действия, редьюсеры, селекторы, методы `src/api/gramjs/methods`, типы `src/api/types`, члены `ApiUpdate`, ключи локализации, записи реестров настроек и горячих клавиш, миграции кэша. Приложение остаётся рабочим на Telegram, поэтому регрессии видны в браузере.

Готово, когда: в UI нет функций из раздела 4, `npm run check:ts` и `npm run check:css` проходят.

### Этап 2. Движок Signal и MVP переписки

- `src/lib/signal`: хранилище, сеть, приём с `unprocessed`, отправка (sealed sender, sender keys для групп, retry receipts через `DecryptionErrorMessage`), синхронизация с основным устройством, группы v2 (состояние, изменения, учётные данные zkgroup), профили, вложения (шифрование, загрузка на CDN v3 по TUS, потоковая расшифровка), storage service (чтение).
- `src/api/signal`: `initApi`, `callApi`, `callApiLocal`, методы, которые нужны UI после этапа 1, и маппинг в `ApiChat`, `ApiUser`, `ApiMessage`.
- Экран привязки вместо экранов Telegram. Функции этапа 2 из раздела 3.

Готово, когда: переписка 1:1 и в группе работает в обе стороны с Android, включая вложения, реакции, правки, удаление и исчезающие сообщения, а перезагрузка вкладки не теряет сообщения.

### Этап 3. Удалить GramJS

Удаляем `src/lib/gramjs`, `src/api/gramjs`, конфиг Telegram в `src/config.ts` и `vite.config.ts` (`TELEGRAM_API_ID`, CSP для `*.web.telegram.org`), загрузку langpack, магические id Telegram (`777000` и другие). Строки локализации кладём в сборку.

### Этап 4. Полный функционал связанного устройства

Функции этапа 4 из раздела 3, включая патч `attest` для CDSI и запись в storage service (архив, закреп, mute, папки, настройки).

### Этап 5. Истории

Приём, просмотр, отправка медиа и текстовых историй, списки рассылки, групповые истории, ответы и реакции, квитанции просмотра.

### Этап 6. Доводка

Функции этапа 6 из раздела 3, шифрование хранилища код-паролем, PWA, брендинг, документация развёртывания прокси, совместимость с актуальными Signal Android, iOS и Desktop.

### Этап R. Звонки (исследование)

WebRTC браузера не может говорить с RingRTC (факт 5). Остаётся свой медиастек: ICE и SRTP в WASM, кодеки через WebCodecs, UDP через прокси как через TURN (прокси видит только SRTP-шифротекст). Для групповых звонков к этому добавляются протокол SFU Signal и шифрование кадров. Это месяцы работы с неясным исходом, поэтому этап вне основного плана, пока не будет отдельного решения.

## 6. Ограничения

- Пока все вкладки закрыты, сообщения копятся на сервере Signal. Android регистрирует для push токен FCM (`lib/libsignal-service/.../RegistrationApi.kt`); Web Push в API Signal я не нашёл (вывод, код сервера не проверял). Значит, уведомлений при закрытом браузере не будет.
- Очистка данных сайта удаляет ключи и историю, после неё нужна повторная привязка. `navigator.storage.persist()` снижает риск вытеснения, но не защищает от ручной очистки.
- История до привязки доступна только через link-and-sync (этап 4) и только если основное устройство её отправило.
- Превью ссылок: как Desktop, через `contentproxy.signal.org` (HTTP CONNECT). Браузер открывает через туннель TLS к content proxy, внутри CONNECT к сайту и второй TLS с публичными корневыми сертификатами (`webpki-roots`). Наш прокси видит только хост content proxy, сайт видит IP Signal.

## 7. Риски

| Риск | Что делаем |
| --- | --- |
| Размер WASM и время старта | Измеряем на этапе 0; ленивая загрузка `zkgroup` и `message-backup` |
| Поддержка форка libsignal при обновлениях Signal | Мост держим отдельным каталогом с минимальными правками общих файлов; обновляемся по тегам libsignal |
| Изменения протокола (новые версии `requiredProtocolVersion`, capability при привязке) | Следим за изменениями в Desktop, обрабатываем неизвестные поля как Desktop |
| Signal может ограничивать сторонние клиенты | Ведём себя как Desktop: те же capability, лимиты запросов, обработка challenge (captcha) |
| Голосовые в OGG/Opus не играют на iOS | Проверяем на этапе 2; при проблеме кодируем AAC через `mediabunny` и WebCodecs или MP3, как Desktop |

## 8. Новые зависимости и инструменты

- Крейты libsignal (AGPLv3) в `rust/libsignal/`, rustls для TLS в WASM, wasm-bindgen.
- Инструменты сборки: Rust по `rust-toolchain` libsignal, цель `wasm32-unknown-unknown`, `wasm-bindgen-cli`, `protoc`. Собранный `.wasm` коммитим, чтобы фронтенд собирался без Rust, или собираем в CI.
- npm: `@bufbuild/protobuf` (рантайм), `@bufbuild/protoc-gen-es` и `@bufbuild/buf` (генерация). Хранилище в IndexedDB через `idb-keyval` и прямой API, прокси на `node:http` и `node:net` без зависимостей.

## 9. Принятые решения (2026-11-20)

1. Прокси: P2, туннель без расшифровки TLS.
2. Protobuf: готовая библиотека protobuf-es (свой генератор заменён по решению от того же дня).
3. Хранилище: IndexedDB.
4. Звонки: исследование этапа R идёт параллельно с основными этапами, результаты в `docs/signal/CALLS_RESEARCH.md`.
5. Отложенные сообщения: локальные, отправляются только при открытой вкладке; интерфейс предупреждает об этом при планировании.
6. Название: TeleSignal.
7. Языки: английский и русский.
8. Форк libsignal: в этом репозитории, `rust/libsignal/`.
