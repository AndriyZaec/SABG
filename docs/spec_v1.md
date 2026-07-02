# Fan Battle Royale — Specification

## 1. Concept

Live survival game для футбольного матчу.

Користувачі заходять в Arena перед або під час матчу. Матч ділиться на фіксовані 5-хвилинні windows. На кожне window система генерує context-aware Yes/No prediction.

Правильна відповідь — користувач проходить далі.  
Неправильна відповідь або відсутність відповіді — користувач вилітає.

---

## 2. Core Loop

1. User заходить у match arena.
2. Отримує або купує entry pass.
3. Чекає наступний prediction round.
4. Отримує Yes/No питання.
5. Має 10–15 секунд на відповідь.
6. Round закривається.
7. TxODDS event data визначає outcome.
8. Правильні відповіді проходять далі.
9. Неправильні або missed answers вилітають.
10. Гра триває до кінця матчу або до одного survivor.

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

---

## 4. Prediction Rules

### Format

Тільки Yes/No.

### Question examples

- Will Team A have a shot between 10:00 and 15:00?
- Will there be a corner between 20:00 and 25:00?
- Will Team B have dangerous possession between 35:00 and 40:00?
- Will there be a card between 50:00 and 55:00?
- Will Team A score between 75:00 and 80:00?

### Context-aware generation

Question Generator враховує:

- current score
- current minute
- possession
- dangerous possession
- high danger possession
- shots
- corners
- cards
- recent attacks
- team momentum
- match phase

Питання має бути релевантне до поточного стану матчу.

---

## 5. Round Lifecycle

### 1. Pending

Round створений для наступного window.

### 2. Open

Користувачі бачать питання і можуть відповісти.

Duration: 10–15 секунд.

### 3. Locked

Відповіді більше не приймаються.

### 4. Settled

Outcome визначений через TxODDS data.

---

## 6. Settlement Rules

### Early settlement

Якщо target event стався до кінця window, round резолвиться одразу.

Приклад:

> Will Team A have a shot between 20:00 and 25:00?

Shot стався на 21:12.

Result:

- YES survives
- NO eliminated

Наступний round все одно буде для window 25:00–30:00.

### Window-end settlement

Якщо window завершилось і target event не стався:

- NO survives
- YES eliminated

### Missed answer

Якщо user не відповів вчасно:

- user eliminated

Default answer не використовується.

---

## 7. Win Conditions

### One survivor

Якщо залишився один active player — він winner.

### Multiple survivors at full time

Якщо після 90:00 залишилось кілька active players — winner визначається за score.

### Score

MVP formula:

- +1 за правильний prediction
- tie-breaker: швидкість відповіді

---

## 8. Spectator Mode

Після вильоту user переходить у spectator mode.

Він може бачити:

- active survivors
- current round
- leaderboard
- match state
- final winner

---

## 9. MVP Features

- Match lobby
- Join arena
- Entry pass
- Live arena screen
- 18 fixed prediction windows
- Context-aware Yes/No questions
- Answer timer
- Elimination logic
- TxODDS-based settlement
- Survivors counter
- Leaderboard
- Spectator mode
- Match summary
- Replay/demo mode

---

## 10. Technical Architecture

### Frontend

Web/PWA.

Screens:

- Match Lobby
- Live Arena
- Prediction Card
- Leaderboard
- Spectator View
- Match Summary

Realtime updates через WebSocket або SSE.

### Backend

#### TxODDS Ingestion

- reads live feed
- normalizes events
- stores match timeline
- emits internal live events

#### Match State Engine

Tracks:

- score
- current minute
- possession
- pressure
- shots
- corners
- cards
- active window

#### Question Generator

Creates context-aware Yes/No questions.

Input:

- match state
- recent events
- current window
- team momentum

Output:

- question text
- target event type
- target team
- window start
- window end
- settlement condition

#### Round Engine

- creates rounds
- opens answer window
- locks answers
- moves game to next window

#### Settlement Engine

- detects target events
- resolves early if event happens
- resolves at window end if event does not happen
- marks users as survived or eliminated

#### Leaderboard Service

- tracks active players
- tracks eliminated players
- calculates score
- resolves final winner

#### Replay Engine

- replays historical TxODDS events
- simulates live match for demo

---

## 11. Data Models

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
- currentMinute
- score

### Arena

- id
- matchId
- status
- activePlayersCount

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
- targetEventType
- targetTeam
- status: pending / open / locked / settled
- correctAnswer
- openedAt
- lockedAt
- settledAt

### Prediction

- id
- roundId
- userId
- answer: yes / no
- answeredAt
- result: correct / incorrect / missed

### LiveEvent

- id
- matchId
- eventType
- team
- matchMinute
- timestamp
- rawPayload

---

## 12. On-chain Layer

MVP use cases:

- wallet identity
- entry pass
- proof of participation
- winner badge
- final result hash

Live round logic and settlement run on backend.

---

## 13. Demo Flow

1. User joins arena.
2. Replay/live match starts.
3. First prediction round opens.
4. Users answer Yes/No.
5. TxODDS event resolves round.
6. Wrong/missed users are eliminated.
7. Survivors continue to next round.
8. Leaderboard updates after each round.
9. At full time, winner is shown.

---

## 14. Pitch

A live survival game for football fans.

During a match, users enter an arena and answer context-aware Yes/No predictions for fixed 5-minute windows. Correct answers keep them alive. Wrong or missed answers eliminate them. The last survivor, or the highest-scoring survivor at full time, wins.

## 15. Tagline

Read the game. Survive the match.
