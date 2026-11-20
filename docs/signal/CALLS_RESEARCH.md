# Звонки Signal в браузере: исследование этапа R

Статус: исследование, 2026-11-20. Продолжает факт 5 и этап R из [PLAN.md](PLAN.md).

Источники (shallow-клоны) и сокращения путей:

- `rr:` — signalapp/ringrtc v2.75.0 (1c386d7), каталог `src/rust/src/`; `rp:` — его `protobuf/protobuf/`.
- `wf:` — форк signalapp/webrtc, ветка `8037e` из `ringrtc/config/version.properties` (f29962d), каталог `ringrtc/rffi/src/`.
- `cs:` — signalapp/Signal-Calling-Service (8718215, SFU), каталог `backend/src/`.
- `dt:` — Signal-Desktop 8.39.0-alpha.1 (01e5971); `an:` — Signal-Android (aa38b25).
- `s0:` — крейт str0m 0.25.0.

Метки: **[П]** проверено по коду или командой; **[В]** вывод или оценка; **[Б]** поведение браузеров по документации, здесь не проверялось.

## Выводы

1. Протокол звонков целиком открыт: RingRTC, его форк WebRTC и SFU. Закрытых частей нет. [П]
2. WebRTC браузера не годится как транспорт ни к телефону, ни к SFU: обе стороны ждут SRTP с ключами из собственного DH, а в SFU кода DTLS нет вовсе. [П]
3. SFU принимает ICE по TCP и TCP+TLS (`cs:config.rs:32-40`), поэтому групповые звонки проходят через существующий туннель без UDP. Для 1:1 без UDP остаётся только TURN Signal по TCP/TLS. Выдаёт ли `/v2/calling/relays` такие адреса, можно проверить только с аккаунта. [П]/[В]
4. Жизнеспособны две архитектуры. **A**: весь медиастек в WASM, кодеки через WebCodecs и libopus. **B**: в WASM только ICE/SRTP-транслятор, медиадвижок — RTCPeerConnection браузера, подключённый к странице «шпилькой» через прокси. B примерно в 1,5–2 раза дешевле и даёт нативные AEC, NetEQ, CC и кодеки, но требует от прокси входящего порта и добавляет задержку. [В]
5. До паритета: A 40–65 инж.-недель, B 25–40. PoC аудио 1:1 занимает 7–10 недель, его ядро общее для обеих архитектур. [В]
6. Рекомендация: собрать общее ядро (сигнализация, ключи, ICE через TURN-TCP, RTP data), получить звук телефона в странице, затем выбрать A или B по замерам эха и задержки.

## 1. Звонки 1:1

### 1.1 Сигнализация

- `CallMessage` в `Content` (шифруется как обычное сообщение Signal): `Offer{id, type, opaque}`, `Answer{id, opaque}`, `repeated IceUpdate{id, opaque}`, `Busy{id}`, `Hangup{id, type NORMAL|ACCEPTED|DECLINED|BUSY|NEED_PERMISSION, deviceId}`, `Opaque{data, urgency}`, `destinationDeviceId` (`dt:protos/SignalService.proto:123-186`). [П]
- Opaque в Offer и Answer — `signaling.Offer/Answer{v4: ConnectionParametersV4}`: `public_key` (X25519, 32 байта), `ice_ufrag`, `ice_pwd`, `max_bitrate_bps`, `encode_only_video_codecs`, `decode_only_video_codecs` (VP8=8, VP9=9, H265=47) (`rp:signaling.proto:16-77`). Оба списка кодеков обязаны быть непустыми даже в аудиозвонке (`wf:peer_connection.cc:474-487`). Версии V1 и V2 с SDP и DTLS не поддерживаются (`rr:core/signaling.rs:22-31`). [П]
- Opaque в IceUpdate — `IceCandidate{added_V3{sdp: "candidate:…"}, removed{ip, port}}` (`rp:signaling.proto:30-47`, `rr:core/signaling.rs:267-278`). [П]
- `CallMessage.Opaque` несёт `signaling.CallMessage` (сообщения групп, ring intention/response) (`rp:signaling.proto:82-112`). Offer и сообщения с `HANDLE_IMMEDIATELY` Desktop отправляет как urgent (`dt:ts/services/calling.preload.ts:3810-3813`). [П]
- Вызываемый сразу отвечает Answer (идёт звонок), а принятие сообщает по RTP data (`Accepted`). Медиа включается только после него (`rr:core/connection.rs:1449-1464, 1634-1660`). [П]

### 1.2 Ключи SRTP

- Стороны обмениваются эфемерными ключами X25519 из V4. HKDF-SHA256 с salt из 32 нулевых байт и info = `"Signal_Calling_20200807_SignallingDH_SRTPKey_KDF" ‖ IK звонящего ‖ IK вызываемого` даёт 88 байт: ключ offer (32) ‖ соль offer (12) ‖ ключ answer (32) ‖ соль answer (12). Набор AEAD_AES_256_GCM, некоммутативный DH отвергается (`rr:core/connection.rs:2407-2463`). IK — 32 байта публичного identity-ключа без байта типа (`dt:ts/services/calling.preload.ts:3413, 3425`). [П]
- Ключ offer ставится в описание offer, ключ answer — в описание answer (`rr:core/connection.rs:763-774, 863-887`). По семантике SDES каждая сторона шифрует своим ключом. [В] В SDP отключается DTLS (`CONNECTIONROLE_NONE`, без fingerprint), ставятся SAVPF и `CryptoParams` (`wf:peer_connection.cc:208-245`). [П]
- Кадрового E2EE в 1:1 нет (`enable_frame_encryption=false`: `rr:native.rs:456`, `rr:android/call_manager.rs:115`), поэтому SRTP — единственная защита медиа. [П]

### 1.3 ICE и TURN

- Полный ICE с trickle и renomination, max-bundle, rtcp-mux (`wf:peer_connection.cc:508-513`, `wf:peer_connection_factory.cc:300-301`). TCP-кандидаты хоста в 1:1 выключены; в режиме relayed используются только relay-кандидаты; сбор кандидатов непрерывный (`wf:peer_connection_factory.cc:302-308, 337-338`). [П]
- TURN: `GET /v2/calling/relays` через аутентифицированный WebSocket chat возвращает `relays[]{username, password, urls, urlsWithIps, hostname, ttl}`. Desktop кеширует ответ на минимальный ttl и ставит `urlsWithIps` (с `hostname`) перед `urls` (`dt:ts/textsecure/WebAPI.preload.ts:834, 1029-1040, 3246-3255`; `dt:ts/services/calling.preload.ts:4322-4396`; `an:lib/network/src/main/java/org/signal/network/api/CallingApi.kt:55-62`). [П]
- Хосты, порты и транспорты в клиентах не зашиты. Тест RingRTC использует `stun:turn3.voip.signal.org` (`ringrtc/src/node/test/CallingClass.ts:206`), симулятор — `turn:turn` и `turn:turn:80?transport=tcp` (`ringrtc/call_sim/src/main.rs:530-535`). Наличие TCP или TLS (`?transport=tcp`, `turns:`) в боевом ответе не проверено. [В]

### 1.4 Медиа

- Opus: PT 102, 48 кГц, `stereo=0`, `ptime=minptime=maxptime=60`, `useinbandfec=1`, `usedtx=1`, `cbr=1`, `maxaveragebitrate=32000`, rtcp-fb transport-cc (`wf:peer_connection.cc:536-552`). Энкодер: 60 мс, 32 кбит/с CBR, complexity 9, FEC, DTX (`rr:webrtc/media.rs:441-466`). [П]
- Видео: VP8 108 (RTX 118); VP9 109 (RTX 119, profile 0) и H.265 110 (RTX 111) по флагам; RED 120, ULPFEC 122; rtcp-fb transport-cc, ccm fir, nack, nack pli, goog-remb. H.264 не согласуется (`wf:constants.h:22-32`, `wf:peer_connection.cc:555-648`, `rp:signaling.proto:49-56`). [П]
- Расширения видео: transport-cc (id 1), video-orientation (4), abs-send-time (12). На аудио transport-cc только при `enable_tcc_audio`. Включён rtcp-rsize (`wf:constants.h:14-19`, `wf:peer_connection.cc:650-681`). [П]
- m-линии: `audio` (sendrecv), `video-mid-0` и `video-mid-1` (send-only и recv-only). SSRC звонящего: 1002 аудио, 1003 видео, 1013 RTX; у вызываемого 2002, 2003, 2013 (`wf:peer_connection.cc:501-505, 718-735`). [П]

### 1.5 RTP data вместо data channel

PT 101, SSRC 0xD. Полезная нагрузка — protobuf `rtp_data.Message{accepted, hangup, senderStatus{video_enabled, sharing_screen, audio_enabled}, receiverStatus{max_bitrate_bps}, seqnum}` без расширений заголовка. Номер пакета и timestamp — счётчик. Накопленное состояние повторяется раз в секунду (`rp:rtp_data.proto:12-53`; `rr:core/connection.rs:69, 88-89, 1525-1590`; `wf:peer_connection.cc:1039-1059`). [П] Пакеты идут тем же SRTP-сеансом, что и медиа. [В]

### 1.6 Полоса

`max_bitrate_bps` в V4: Low 300 кбит/с, Normal 2 Мбит/с (`rr:common/mod.rs:838-844`); во время звонка лимит передаёт `ReceiverStatus`. [П] Удалённый libwebrtc ведёт googcc по нашим transport-cc feedback и REMB. Аудио требует около 32 кбит/с плюс ~5 кбит/с заголовков, для PoC контроль перегрузки не нужен. [В]

## 2. Групповые звонки и call links

### 2.1 SFU и учётные данные

- URL SFU: `https://sfu.voip.signal.org/` (`dt:config/production.json:9`). HTTP к нему выполняет приложение (`dt:ts/services/calling.preload.ts:663, 4170-4196`). Сертификат выдан частным CA Signal (PLAN, факт 4), значит TLS идёт в WASM, как для chat. [П]
- Peek: `GET /v2/conference/participants`. Join: `PUT` того же пути с JSON `{iceUfrag, icePwd, dhePublicKey (hex), hkdfExtraInfo (hex), requiresSvc, adminPasskey?}`. Ответ: `{demuxId, udpAddresses, tcpAddresses, tlsAddresses, hostname, iceUfrag, icePwd, dhePublicKey, callCreator, conferenceId, clientStatus}` (`rr:lite/sfu.rs:238-262, 512-516, 645-735`). Desktop передаёт пустой `hkdfExtraInfo` (`dt:ts/services/calling.preload.ts:1531-1534, 1622-1628`). [П]
- Группы: `Authorization: Basic base64(uuid:token)`, где token берётся из `GET /v2/groups/token` на storage (групповая zk-авторизация, ответ `ExternalGroupCredential`) (`rr:lite/sfu.rs:487-503`; `dt:ts/textsecure/WebAPI.preload.ts:858, 4776-4787`). [П]
- Call links: `Authorization: Bearer auth.<base64(CallLinkAuthCredentialPresentation)>`, заголовки `X-Room-Id` и `X-Epoch` из root key, состояние — `/v1/call-link` (GET, PUT, DELETE) (`rr:lite/call_links.rs:124-129`, `rr:lite/call_links/root_key.rs:149, 301`). Credential приходит из `GET /v1/certificate/auth/group?…&zkcCredential=true` (`dt:ts/textsecure/WebAPI.preload.ts:4745-4760`), создание ссылки — `POST /v1/call-link/create-auth` (`an:…/CallingApi.kt:70-77`). zkgroup собирается в WASM (PLAN, факт 1). [П]
- GroupSendEndorsements: SFU присылает `SfuToDevice.endorsements` (`rp:group_call.proto:158-162`), RingRTC рассылает по ним ключи участникам call link (`rr:core/group_call.rs:3848-3863`). Android пока логирует «not handled yet» (`an:app/src/main/java/org/thoughtcrime/securesms/service/webrtc/SignalCallManager.java:987-988`), Desktop обработчик не регистрирует. [П] Для PoC это не нужно. [В]

### 2.2 Транспорт и SRTP с SFU

- Клиент — полный ICE. Адреса SFU добавляются как host-кандидаты udp, tcp или tls (для tls — с hostname) (`wf:peer_connection.cc:939-984`). TCP-кандидаты в группах включены (`wf:peer_connection_factory.cc:306-308`). SFU слушает UDP и TCP (по умолчанию порт 10000) и, если настроено, TCP+TLS с сертификатом для `hostname` (`cs:config.rs:27-40, 124-138`). TCP-кадрирование — 2-байтовая длина, RFC 4571 (`cs:packet_server/epoll.rs:1121`). [П]
- Ключи: X25519 между клиентом и SFU, HKDF-SHA256 (salt нулевой, info = `"Signal_Group_Call_20211105_SignallingDH_SRTPKey_KDF" ‖ hkdfExtraInfo`) → 56 байт: ключ клиента (16) ‖ соль (12) ‖ ключ сервера (16) ‖ соль (12), набор AEAD_AES_128_GCM (`rr:core/group_call.rs:173-200, 495-525`). SFU считает по той же формуле (`cs:sfu.rs:787-797`). [П]

### 2.3 Кадровое E2EE

- У каждого отправителя 32-байтный секрет. Ключи: HKDF(secret, "RingRTC AES Key") и HKDF(secret, "RingRTC HMAC Key"), храповик: secret ← HKDF(secret, "RingRTC Ratchet") (`rr:core/crypto.rs:25, 76-110`). Кадр шифруется AES-256-CTR с IV = frame_counter (u64 BE в 16 байтах). MAC = HMAC-SHA256(IV ‖ длина ‖ шифротекст ‖ 0u32), усечённый до 16 байт (`rr:core/crypto.rs:204-230, 349-375`). [П]
- Формат: зашифрованный закодированный кадр целиком ‖ ratchet_counter (1 байт) ‖ frame_counter (4 байта BE) ‖ MAC (16 байт) (`rr:core/group_call.rs:3920-3990, 5553`). [П]
- Ключ распространяется как `DeviceToDevice.MediaKey{ratchet_counter, secret, demux_id}` внутри `signaling.CallMessage` в `CallMessage.Opaque` обычными сообщениями Signal: группе — групповой отправкой, иначе по одному (`rr:core/group_call.rs:3804-3890`; `rp:group_call.proto:24-58`; `dt:ts/services/calling.preload.ts:3579-3640`). Новый ключ применяется через 5 с после рассылки (`rr:core/group_call.rs:917-928`). [П]

### 2.4 Потоки, simulcast, RTP data

- `demux_id` кратен 16. SSRC: аудио = `demux_id`; слои VP8-simulcast `|2`, `|4`, `|6` с RTX `|3`, `|5`, `|7`; VP9 SVC `|8` с RTX `|9` (`wf:group_call_sdp_builder.h:26-52`). Opus идёт с audio-level (id 5) без TCC; видео (VP8 или VP9 SVC) с transport-cc (1), orientation (4), dependency descriptor (6), у отправителя ещё video-layers-allocation (14) (`wf:group_call_sdp_builder.cc:113-232`). [П]
- SFU переключает слои по ключевым кадрам из dependency descriptor (`cs:call.rs:3647-3655`, `cs:rtp/packet.rs:42-46`). [П] Без DD видео клиента пересылаться не будет. [В]
- RTP data (PT 101): клиент→SFU по SSRC 1 (`DeviceToSfu`: VideoRequest, leave, admin, raise hand, stats); сообщения больше 1140 байт идут через надёжный протокол MRP. Рассылка через SFU идёт по SSRC `demux_id+0xD` с кадровым шифрованием (`DeviceToDevice`: heartbeat с мутом раз в 1 с, leaving, reaction, remote mute). От SFU приходят speaker, device joined/left, current devices, stats, removed, raised hands, endorsements, server_address (`rr:core/group_call.rs:887-890, 1257, 1284-1290, 4276-4300`; `rp:group_call.proto:60-229`). MRP — отдельный крейт `ringrtc/mrp` (2147 строк, без WebRTC). [П]
- Лимиты отправки: 1 Мбит/с в малом звонке, 671 кбит/с в большом, демонстрация экрана 0,5–2 Мбит/с (`rr:core/group_call.rs:897-906`). SFU сам ведёт googcc по TCC и шлёт NACK и PLI (`cs:googcc.rs`, `cs:rtp/rtcp.rs:37-51`). [П]

## 3. Возможности браузера [Б]

| API | Что даёт | Ограничение |
| --- | --- | --- |
| RTCPeerConnection | ICE, DTLS-SRTP, NetEQ, AEC, googcc, кодеки | Ключи SRTP только из DTLS, SDES не поддерживается |
| Encoded Transform (`RTCRtpScriptTransform`, в Chrome ещё `createEncodedStreams`) | Закодированные кадры до пакетизации | Годится для кадрового E2EE, на транспорт не влияет |
| WebCodecs | Кодирование и декодирование VP8/VP9 и Opus | VP8 и `AudioEncoder` в Safari проверить; `AudioDecoder` не даёт PLC и FEC |
| AudioWorklet | Захват и вывод PCM | Свой jitter buffer; учитывает ли AEC звук из Web Audio — зависит от браузера |
| WebSocket | Уже используемый TCP-туннель | Блокировка очереди при потерях |
| WebTransport, ненадёжный DataChannel | Датаграммы до своего сервера | На сервере нужны QUIC или SCTP; WebTransport в Safari проверить |
| Сырой UDP | Нет | — |

## 4. Архитектуры

### Общее ядро для A и B

- Сигнализация и автоматы звонка переносятся как логика из `rr:core/call_fsm.rs`, `connection_fsm.rs`, `group_call.rs`. Сам RingRTC в WASM не переносится: ядро построено на потоках и блокирующих ожиданиях (`std::thread`, `Condvar` в `rr:core/*.rs`), медиа — libwebrtc на C++. Без изменений переносимы `rr:core/crypto.rs`, `ringrtc/mrp`, protobuf и `rr:lite`. [П]/[В]
- В WASM нужны ICE, TURN-клиент и SRTP с внешними ключами. str0m 0.25.0 с `default-features = false, features = ["rust-crypto"]` проходит `cargo check --target wasm32-unknown-unknown` (Rust 1.98.1) после одной правки: `str0m-rust-crypto` тянет `dimpl/rcgen`, а с ним aws-lc-sys на C, и заглушка `generate_certificate` убирает эту зависимость. [П] Чего ещё не хватает в str0m [П]:
  - `std::time::Instant` и `SystemTime` паникуют в wasm32-unknown-unknown, а str0m вызывает их в `s0:src/util/time_tricks.rs`, поэтому нужна замена на `web-time`;
  - нужен публичный API ключей SRTP без DTLS: `Session::set_keying_material` внутренний, а порядок ключей RFC 5764 отличается от RingRTC;
  - нет TURN-клиента и dependency descriptor, VLA есть (`s0:README.md`, раздел Features).
- Альтернатива str0m — минимальный стек из частей SFU: `cs:ice.rs`, `cs:rtp/srtp.rs`, `cs:rtp/rtcp.rs`, `cs:transportcc.rs`, `cs:googcc.rs` (AGPL). [В]
- str0m, dimpl и биндинг libopus — новые зависимости, по правилам репозитория их нужно согласовать.

### A. Весь медиастек в WASM

Схема: getUserMedia → AudioWorklet → libopus (WASM) → RTP/SRTP (WASM) → туннель → TURN или SFU. Обратно: SRTP → jitter buffer → декодирование libopus с PLC/FEC → AudioWorklet. Видео: WebCodecs VP8, свои пакетизация, NACK, RTX, PLI и оценка полосы (`s0:src/bwe`). libopus в WASM уже есть в зависимостях (`opus-recorder`, `package.json:147`; `src/util/oggToWav.ts:1`), но его воркеры работают с Ogg, для сырых пакетов нужен свой биндинг. [П]/[В]

- **Что видит прокси.** TCP к TURN или SFU. При `turn:` по TCP — сообщения TURN открытым текстом: временные учётные данные и адреса собеседника в XOR-PEER-ADDRESS. Дальше — заголовки RTP (SSRC, номера, расширения; в группах — уровень звука), размеры и тайминг пакетов. При `turns:` или TLS к SFU видно только TLS. Прокси меняется только в allowlist: IP из ответов relays и join приходится разрешать по резолву имён `*.voip.signal.org`. [В]
- **Чего не хватает.** Адаптивный jitter buffer с растяжением (аналог NetEQ); PLC и FEC (есть в libopus); AEC (если браузер не учитывает звук из Web Audio, обход — петля через локальный RTCPeerConnection); CC и simulcast видео; синхронизация звука и видео; микширование N потоков.
- **Оценка.** Ядро 10–17, аудио 6–12, видео 1:1 8–14, группы 14–24: всего 40–65 инж.-недель (±50 %). [В]
- **Риски.** Качество звука (эхо, задержка, рывки), нагрузка на CPU от трёх энкодеров VP8 для simulcast, блокировки TCP, Safari.

### B. SRTP-транслятор в WASM и WebRTC браузера

Схема [В]:

- Страница создаёт RTCPeerConnection, описание удалённой стороны пишет сама с теми же PT, SSRC и расширениями, что у собеседника.
- Кандидат этого соединения — порт прокси. Прокси без разбора содержимого отдаёт пакеты в WebSocket той же страницы, маршрут выбирает по ufrag из STUN USERNAME.
- WASM держит ICE-lite и DTLS-сервер (dimpl) к браузеру, а к сети — ICE, TURN и SRTP Signal. Пакеты расшифровываются и шифруются заново, SSRC и PT переписываются в RTP и RTCP. TCC, NACK, PLI и padding проходят один к одному, поэтому контроль перегрузки работает сквозным.
- RTP data (PT 101) обрабатывает сам WASM. Кадровое шифрование групп выполняется в воркере Encoded Transform на основе `rr:core/crypto.rs`.

Оценка и риски:

- **Что видит прокси.** То же, что в A, и вдобавок DTLS-SRTP между браузером и страницей. Ключи этого сеанса согласуются внутри страницы, отпечатки её не покидают.
- **Плюсы.** NetEQ, AEC, PLC, Opus FEC, googcc, VP8/VP9 и simulcast работают нативно.
- **Чего не хватает.** Шпилька в прокси (UDP через `dgram` или TCP-листенер, оценочно 150–250 строк без зависимостей); генерация DTLS-сертификата без rcgen и aws-lc.
- **Оценка.** Ядро 10–17, транслятор со шпилькой 4–7 (аудио и видео 1:1), группы 10–16: всего 25–40 инж.-недель (±50 %).
- **Риски:**
  - каждый пакет делает лишний круг до прокси: задержка растёт на RTT до прокси в каждую сторону, трафик через прокси удваивается;
  - прокси нужен входящий порт;
  - примет ли браузер simulcast по SSRC (`a=ssrc-group:SIM`) или придётся переписывать RID в SSRC;
  - примет ли браузер полностью зашифрованные кадры VP8, распознавая ключевые кадры по DD;
  - поддержка DD и VLA в Firefox и Safari.

### Отвергнуто

- **Прямой WebRTC браузера**: невозможен (разделы 1.2 и 2.2).
- **RingRTC целиком в WASM**: libwebrtc на C++ и `std::thread`, а в wasm32-unknown-unknown потоков нет.
- **Медиашлюз в прокси, завершающий SRTP**: в 1:1 нет кадрового E2EE, поэтому шлюз слышал бы разговор. Это нарушает принцип прокси, который не видит содержимого.

### Транспорт к Signal для A и B

- **T1. TCP через существующий туннель.** Для 1:1 — TURN по TCP или TLS, если Signal их выдаёт; для групп — ICE-TCP или TLS к SFU, поддержка подтверждена. Минимум изменений, но при потерях TCP добавляет задержку.
- **T2. UDP-релей в прокси.** Браузер доходит до прокси по WebTransport или ненадёжному DataChannel, дальше идёт UDP к TURN или SFU. Задержка ниже, но на сервере нужны QUIC или SCTP (в Node без зависимостей их нет). Релей придётся ограничить адресами Signal, иначе получится открытый UDP-ретранслятор. Решать после замеров T1.

## 5. PoC: шаги

Нужен второй аккаунт Signal на телефоне. Каждый шаг заканчивается проверяемым результатом.

| Шаг | Срок | Что делаем | Критерий успеха |
| --- | --- | --- | --- |
| M0 | 1 нед. | KDF 1:1 и групп, кадровое шифрование в Rust/WASM | Байты совпадают с выводом функций, перенесённых из RingRTC |
| M1 | 1–2 нед. | Разбор входящих `CallMessage`, лог V4 и кандидатов, ответ `Busy` | Звонящий видит «занято» |
| M2 | 0,5 нед. | `GET /v2/calling/relays` | Записаны реальные URL, транспорты и ttl. Если TCP и TLS нет, сразу T2 или только группы |
| M3 | 1 нед. | TURN по TCP/TLS через туннель: Allocate, Refresh, CreatePermission | Получен relay-адрес, замерен RTT |
| M4 | 1–2 нед. | Исходящий звонок (ICE controlling): Offer с VP8 в обоих списках, только relay-кандидаты | STUN binding проходит в обе стороны через TURN |
| M5 | 0,5 нед. | После принятия на телефоне расшифровать RTP data `Accepted` (PT 101, SSRC 0xD) ключом answer | `id` совпадает с call id: ключи и порядок IK верны |
| M6 | 1 нед. | Opus PT 102 → libopus WASM → AudioWorklet с фиксированным буфером | Слышен телефон |
| M7 | 1–2 нед. | Захват → Opus 60 мс CBR 32 кбит/с → SSRC 1002 с ключом offer; `SenderStatus` и `Hangup` по RTP data и сигнализации | Двусторонний разговор 5 минут |
| M8 | 1–2 нед. | Входящий звонок: Offer → звонок в UI → Answer | `Hangup ACCEPTED` от другого своего устройства гасит звонок |

M0–M7 занимают 7–10 недель.

После M7 — точка решения A или B: замерить эхо на громкой связи, задержку «рот–ухо» и поведение при потерях, затем провести тот же звонок через шпильку B (спайк на 2–3 недели).

Затем группы:

| Шаг | Срок | Что делаем | Критерий успеха |
| --- | --- | --- | --- |
| G1 | 0,5 нед. | Peek с токеном из `v2/groups/token` | Получен список участников |
| G2 | 1–2 нед. | Join, ICE-TCP к SFU через туннель, SRTP AES-128-GCM | Расшифрован `SfuToDevice` (PT 101, SSRC 1) |
| G3 | 1–2 нед. | `MediaKey` из сообщения Signal → расшифровка кадров одного участника | Слышен участник |
| G4 | 1–2 нед. | Отправка звука, рассылка своего `MediaKey`, heartbeat | Нас слышат на телефоне |

## 6. Открытые вопросы

- Какие транспорты возвращает `/v2/calling/relays` (шаг M2).
- Цепочка сертификатов TLS-порта SFU и `turns:`.
- Учитывает ли AEC звук из Web Audio в Chrome, Firefox и Safari.
- Принимает ли браузер полностью зашифрованные кадры VP8 с DD (B, группы).
- Лицензии: RingRTC и SFU — AGPLv3, как libsignal (PLAN, раздел 2); str0m, dimpl и `is` — MIT или Apache-2.0 (`Cargo.toml` крейтов).
