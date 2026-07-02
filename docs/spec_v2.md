# Fan Battle Royale — Specification v2

> v2 closes the open gaps from v1: round/window timing, settle-able event whitelist,
> TxODDS feed latency, halftime & stoppage time, entry/prize economics (Solana devnet),
> late-join/reconnect rules, spectator answer privacy, and tie-breaks.
> Product decisions locked: paid entry → prize pool (simplified, Solana devnet, hackathon);
> natural questions with final-by-score (no forced 50/50, no sudden death);
> join only before start, reconnect forgiven.

## 1. Concept

Live survival game для футбольного матчу.

Користувачі заходять в Arena перед матчем. Матч ділиться на фіксовані 5-хвилинні windows. На кожне window система генерує context-aware Yes/No prediction.

Правильна відповідь — користувач проходить далі.
Неправильна відповідь або відсутність відповіді — користувач вилітає.

Гра монетизується через paid entry, з якого формується prize pool (Solana devnet для MVP/хакатону).

---

## 2. Core Loop

1. User заходить у match lobby **до старту матчу**.
2. Купує entry pass (on-chain, Solana devnet) — це фіксує його в prize pool.
3. Чекає старт арени (kickoff).
4. Перед кожним window отримує Yes/No питання.
5. Має **щонайменше 60 секунд** на роздуми — **answer window закривається на межі window start** (див. §5).
6. Round локається.
7. TxODDS event data визначає outcome.
8. Правильні відповіді проходять далі.
9. Неправильні або missed answers вилітають.
10. Гра триває до кінця матчу або до одного survivor.
11. Prize pool розподіляється між winner / топ survivors (див. §12).

---

## 3. Match Windows

Regular time ділиться на 18 fixed windows:

- 00:00–05:00
- 05:00–10:00
- 10:00–15:00
- 15:00–20:00
- 20:00–25:00
- 25:00–30:00
- 30:00–35:00
- 35:00–40:00
- 40:00–45:00
- 45:00–50:00
- 50:00–55:00
- 55:00–60:00
- 60:00–65:00
- 65:00–70:00
- 70:00–75:00
- 75:00–80:00
- 80:00–85:00
- 85:00–90:00

Кожне window має один prediction round.

Питання завжди привʼязане до конкретних меж:

> Between 25:00 and 30:00, will Team A have a shot?

### 3.1 Stoppage time mapping

TxODDS повідомляє match minute з урахуванням доданого часу (напр. `45+2`, `90+4`). Правила мапінгу на windows:

- **First-half stoppage** (`45+X`) додається до window **40:00–45:00**. Подія на 45+2 рахується в цьому window.
- **Second-half stoppage** (`90+X`) додається до window **85:00–90:00**.
- Тобто крайні windows кожного тайму "поглинають" свій stoppage time. Межа closes коли арбітр свистить кінець тайму (TxODDS `period_end` event), а не строго по таймеру.

### 3.2 Halftime

Window **45:00–50:00** охоплює перерву. Round для цього window:

- Опціонально **skip**: якщо break, round 45:00–50:00 не створюється, гра відновлюється з window 50:00–55:00 на second-half kickoff. **Default для MVP — skip**, щоб уникнути тривіального NO-питання під час перерви.
- Round Engine орієнтується на TxODDS `period_start` / `period_end`, а не на абсолютний таймер.

> Це знижує число рандів з 18 до 17, але прибирає "мертве" питання.

---

## 4. Prediction Rules

### Format

Тільки Yes/No.

### Question examples

- Will Team A have a shot between 10:00 and 15:00?
- Will there be a corner between 20:00 and 25:00?
- Will there be a card between 50:00 and 55:00?
- Will Team A score between 75:00 and 80:00?

### 4.1 Settle-able event whitelist

Settlement має бути детермінованим і неоспорюваним. Тому **target event** питання обирається ТІЛЬКИ зі списку дискретних, однозначно детектованих TxODDS подій:

| target event   | TxODDS signal                  |
| -------------- | ------------------------------ |
| shot           | shot (on/off target)           |
| shot_on_target | shot on target                 |
| corner         | corner awarded                 |
| card           | yellow / red card              |
| goal           | goal                           |
| free_kick      | free kick awarded              |
| penalty        | penalty awarded                |
| substitution   | substitution                   |

**Fuzzy стани НЕ є target events** (`dangerous possession`, `team momentum`, `match phase`, `pressure`, `recent attacks`). Вони використовуються ТІЛЬКИ як context для генерації питання, ніколи як settlement condition.

### 4.2 Context-aware generation

Question Generator враховує (input, не settlement): current score, current minute, possession, dangerous/high-danger possession, shots, corners, cards, recent attacks, team momentum, match phase.

**Generation policy (natural questions):**

- Питання має бути релевантним до поточного стану матчу.
- Генератор **не зобовʼязаний** форсувати 50/50 split. Питання природні (можуть бути 70/30).
- Проте генератор **уникає тривіально вирішених питань** на момент генерації: не ставить питання про подію, яка фактично вже неминуча або вже відбулась у поточному стані.
- Якщо багато гравців доживає до full time — переможець визначається за score (§7), а не sudden death.

---

## 5. Round Lifecycle & Timing

Кожен round для window `[T, T+5]` проходить:

### 1. Pending

Round згенерований для наступного window (питання + target event готові), ще не показаний.

### 2. Open

- Round **відкривається щонайменше за 60 секунд до window start** (`openAt = T − leadTime`, `leadTime ≥ 60s`, default `60s`, за match clock фіда).
- Користувачі бачать питання і мають час подумати; можуть відповісти або змінити відповідь до lock.
- Answer timer показує countdown до `lockAt`.
- `leadTime` конфігурований; його можна збільшити (round відкривається раніше, щойно зрезолвився попередній), але **не менше 60s**, щоб гравець не проґавив раунд.

### 3. Locked

- Round **локається рівно на window start** (`lockAt = T`).
- Відповіді більше не приймаються.
- **Гарантія чесності:** target event не може настати до lock, бо observation вікно `[T, T+5]` починається саме на lock. Жоден early settlement не відбувається під час open phase — довший lead time цього не змінює, бо lock завжди на `T`.

### 4. Settled

Outcome визначений через TxODDS data (early або window-end, §6).

> Перший round (window 00:00–05:00) відкривається за `leadTime` (≥60s) до kickoff. Кожен наступний round відкривається під час попереднього window (там ~5 хв запасу), тож гравець завжди має щонайменше хвилину на роздуми і паузи між раундами немає.

### 5.1 Match clock vs feed latency

- Всі таймінги (`openAt`, `lockAt`, settlement) рахуються по **match clock, який веде TxODDS feed**, а не по таймеру трансляції.
- Це усуває переваги від low-latency трансляції: всі гравці лочаться відносно однієї точки фіда.
- Settlement Engine приймає подію тільки коли feed її **підтвердив** (confirmed, не provisional) і `matchMinute` потрапляє в `[T, T+5]`.

---

## 6. Settlement Rules

### Early settlement

Якщо confirmed target event стався в межах window до його кінця, round резолвиться одразу.

Приклад:

> Will Team A have a shot between 20:00 and 25:00?

Confirmed shot на 21:12 →

- YES survives
- NO eliminated

Наступний round все одно буде для window 25:00–30:00.

### Window-end settlement

Якщо window завершилось (`period_end` або match minute > `T+5` + stoppage) і target event не стався:

- NO survives
- YES eliminated

### Missed answer

Якщо user не відповів до lock:

- user eliminated
- Default answer не використовується.
- **Виняток (reconnect):** див. §9 — падіння зʼєднання не карає, якщо відповідь технічно дійшла до lock.

---

## 7. Win Conditions

### One survivor

Якщо залишився один active player — він winner, гра завершується достроково.

### Multiple survivors at full time

Якщо після останнього window (90:00 + stoppage) залишилось кілька active players — winner визначається за **score** (це очікуваний дефолтний шлях, без sudden death).

### Score (MVP formula)

- **+1** за кожен правильний prediction.
- **Tie-breaker 1:** сумарна швидкість відповіді (менший середній `answeredAt − openedAt`).
- **Tie-breaker 2:** менша кількість missed/skipped раундів.
- **Tie-breaker 3:** раніший `joinedAt`.
- Якщо все рівне — **shared win**, prize pool ділиться порівну між tied winners.

---

## 8. Spectator Mode

Після вильоту user переходить у spectator mode.

Він бачить:

- active survivors
- current round (питання)
- leaderboard
- match state
- final winner

**Privacy:** живі відповіді active survivors **НЕ показуються** спектаторам (і іншим гравцям) до `lock`. Після lock агреговані числа (X% Yes / Y% No) можна показати; індивідуальні відповіді — тільки після settle. Це прибирає можливість підглядати чужий вибір.

---

## 9. Join / Reconnect Rules

### Late join

- Join дозволений **тільки до старту арени** (kickoff / `period_start` першого тайму).
- Після старту арена closed для нових гравців. Можна лише spectate.

### Reconnect

- Падіння WebSocket/SSE під час open round **не карає** гравця, якщо його відповідь технічно дійшла до бекенду до `lock`.
- Бекенд є source of truth: статус відповіді визначається за отриманим payload, не за станом сокета.
- Якщо відповідь не дійшла до lock — `missed` → eliminated (звичайне правило §6).
- Після reconnect клієнт ресинкається з поточним станом арени/раунду.

---

## 10. MVP Features

- Match lobby
- Join arena (pre-start only)
- Paid entry pass (Solana devnet)
- Live arena screen
- 17–18 fixed prediction windows (halftime skip)
- Context-aware Yes/No questions (whitelisted events)
- Answer timer (≥60s to think, lock on window start)
- Elimination logic
- TxODDS-based settlement (early / window-end)
- Survivors counter
- Leaderboard + MVP score
- Spectator mode (with answer privacy)
- Prize pool distribution
- Match summary
- Replay/demo mode

---

## 11. Technical Architecture

### Frontend

Web/PWA.

Screens:

- Match Lobby
- Live Arena
- Prediction Card
- Leaderboard
- Spectator View
- Match Summary

Realtime updates через WebSocket або SSE. Match clock синхронізується з фідом, не з клієнтським годинником.

### Backend

#### TxODDS Ingestion

- reads live feed
- normalizes events до whitelisted типів (§4.1)
- distinguishes provisional vs confirmed events
- stores match timeline
- emits internal live events (з match minute + stoppage)

#### Match State Engine

Tracks: score, current minute (incl. stoppage), period (1st/HT/2nd), possession, pressure, shots, corners, cards, active window.

#### Question Generator

Creates context-aware Yes/No questions.

Input: match state, recent events, current window, team momentum.

Output:

- question text
- target event type (з whitelist)
- target team (or any)
- window start / window end
- **settlement condition** (явна, машиночитна умова резолву)

Policy: natural questions, уникати тривіально вирішених (§4.2).

#### Round Engine

- creates rounds (pending)
- opens round at `T − leadTime` (`leadTime ≥ 60s`, default 60s)
- locks answers at `T` (window start)
- handles halftime skip / stoppage via `period_start`/`period_end`
- moves game to next window

#### Settlement Engine

- detects confirmed target events у `[T, T+5]`
- resolves early if event happens
- resolves at window end if event does not happen
- marks users survived / eliminated

#### Leaderboard Service

- tracks active / eliminated players
- calculates score + tie-breakers
- resolves final winner(s)

#### Payout Service

- holds entry funds in escrow (Solana devnet program)
- on match end, computes prize distribution
- triggers on-chain payout to winner(s)

#### Replay Engine

- replays historical TxODDS events
- simulates live match for demo (з тими ж round/settlement правилами)

---

## 12. On-chain Layer (Solana, devnet)

MVP use cases:

- wallet identity
- **entry pass purchase** → внесок у prize pool (escrow)
- proof of participation
- winner badge
- final result hash
- **prize payout** до winner(s)

### Prize pool (simplified)

- Кожен entry pass = фіксований внесок у lamports (devnet SOL або devnet SPL-токен).
- Pool = сума всіх entries мінус опціональний platform fee (для MVP можна 0%).
- **Distribution (default MVP):** winner-takes-all. Якщо shared win (§7) — рівний поділ між tied winners.
- Escrow тримається простою Anchor-програмою; payout ініціює Payout Service після фіналізації leaderboard.

> Live round logic та settlement — на бекенді (off-chain); on-chain тільки кошти, identity та фінальний результат.

---

## 13. Data Models

### User

- id
- walletAddress
- username
- avatar

### Match

- id
- homeTeam
- awayTeam
- startTime
- status
- currentMinute (incl. stoppage)
- period: pre / first_half / halftime / second_half / full_time
- score

### Arena

- id
- matchId
- status: lobby / live / finished
- activePlayersCount
- entryFeeLamports
- prizePoolLamports
- escrowAccount (on-chain address)

### EntryPass

- id
- arenaId
- userId
- walletAddress
- amountLamports
- txSignature (on-chain)
- status: paid / refunded
- purchasedAt

### ArenaPlayer

- id
- arenaId
- userId
- status: active / eliminated / winner
- score
- joinedAt
- eliminatedRoundId

### PredictionRound

- id
- arenaId
- matchId
- windowStartMinute
- windowEndMinute
- question
- targetEventType (whitelisted)
- targetTeam
- settlementCondition (machine-readable)
- status: pending / open / locked / settled
- correctAnswer
- openedAt
- lockedAt
- settledAt
- settledBy: early / window_end

### Prediction

- id
- roundId
- userId
- answer: yes / no
- answeredAt
- receivedAt (для reconnect tie-break, §9)
- result: correct / incorrect / missed

### LiveEvent

- id
- matchId
- eventType (whitelisted)
- team
- matchMinute (incl. stoppage)
- timestamp
- confirmed: bool (provisional vs confirmed)
- rawPayload

### Payout

- id
- arenaId
- userId
- amountLamports
- txSignature
- status: pending / sent / failed

---

## 14. Demo Flow

1. User connects wallet, buys entry pass (devnet).
2. Arena starts (replay or live).
3. First prediction round opens ≥60s before kickoff.
4. Users answer Yes/No before window start.
5. Round locks; TxODDS confirmed event resolves it (early or at window end).
6. Wrong/missed users eliminated; reconnects forgiven if answer landed.
7. Survivors continue; halftime window skipped.
8. Leaderboard updates after each round.
9. At full time, winner (one survivor or top score) shown.
10. Prize pool paid out on-chain to winner(s).

---

## 15. Pitch

A live survival game for football fans.

During a match, users buy in and enter an arena, answering context-aware Yes/No predictions for fixed 5-minute windows. Correct answers keep them alive. Wrong or missed answers eliminate them. The last survivor — or the highest-scoring survivor at full time — takes the prize pool.

## 16. Tagline

Read the game. Survive the match.

---

## 17. Changelog (v1 → v2)

- **Timing:** round opens `T − leadTime` (≥60s to think, default 60s), locks exactly on window start `T`; observation `[T, T+5]` — early settlement can no longer fire before lock.
- **Settlement integrity:** introduced whitelisted target events; fuzzy states (dangerous possession, momentum) are context-only.
- **Feed latency:** all timing on TxODDS match clock; settle only on confirmed events.
- **Stoppage/halftime:** stoppage folded into boundary windows; halftime window skipped by default.
- **Economics:** added paid entry → prize pool, escrow + payout on Solana devnet; winner-takes-all (shared on tie).
- **Join/reconnect:** join only before start; reconnect forgiven if answer reached backend before lock.
- **Spectator privacy:** live answers hidden until lock.
- **Tie-breaks:** extended (speed → fewer misses → earlier join → shared win).
- **Data models:** added EntryPass, Payout; added `settlementCondition`, `settledBy`, `receivedAt`, `confirmed`, period/escrow/pool fields.
