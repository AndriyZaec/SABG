# Fan Battle Royale — Build Plan (v2 → реалізація)

> Технічна розбивка spec v2 на **автономні блоки** для двох розробників.
> Мета: після Phase 0 (контракти) кожен пиляє свій трек паралельно, через моки.
>
> **Stack:** Node.js (TypeScript) backend, mobile-web + full web frontend (React/Vite PWA),
> Solana (Anchor) on-chain, devnet. WS для realtime.
>
> **Owners:**
> - **Viktor** — backend core, WS/feed parsing, realtime, live-arena frontend.
> - **Андрій** — Solana program, payout bridge, wallet/identity, entry/payout frontend.

---

## 0. Архітектура й шви (interface seams)

Паралельність тримається на 5 контрактах. Поки контракт зафіксований — обидві сторони працюють незалежно, кожен мокає чужу сторону.

| # | Шов | Хто продюсер | Хто консюмер | Форма |
|---|-----|--------------|--------------|-------|
| S1 | **Shared contracts** | обидва | усі | TS-пакет `@arena/contracts`: DTO, enums, entity-типи |
| S2 | **REST + WS API** | backend | frontend | OpenAPI + WS message catalog + mock-сервер |
| S3 | **Internal event bus** | Ingestion | engines | normalized `LiveEvent` stream (EventEmitter/Redis pub/sub) |
| S4 | **On-chain IDL** | Solana program | Payout Service + wallet FE | Anchor IDL + TS клієнт |
| S5 | **Settlement condition** | Question Generator | Settlement Engine | машиночитний JSON (DSL нижче) |

### S5 — формат settlement condition (узгодити першим, він простий)

```jsonc
{
  "targetEventType": "shot",        // з whitelist §4.1
  "targetTeam": "home",             // "home" | "away" | "any"
  "windowStartMinute": 25,
  "windowEndMinute": 30,
  "resolve": "event_in_window"      // YES якщо ≥1 confirmed подія в [start,end]
}
```

Settlement Engine — чиста функція: `(condition, events[]) => "yes" | "no"`. Тестується ізольовано, без матчу.

### Високорівнева топологія

```
TxODDS feed ──► [Ingestion/Parser] ──S3──► [Match State Engine]
                                              │
                              ┌───────────────┼───────────────┐
                        [Question Gen]   [Round Engine]   [Settlement Engine]
                              └───────────────┼───────────────┘
                                       [Leaderboard]
                                              │
                              [Realtime Gateway WS/SSE] ──► clients
                                              │
                                      [Payout Service] ──S4──► [Solana program]
```

---

## Phase 0 — Foundation (blocking, ~1 день, разом)

Без цього паралельність не починається. Робимо вдвох, швидко.

| ID | Блок | Owner | Вихід |
|----|------|-------|-------|
| P0.1 | Monorepo (pnpm workspaces: `apps/api`, `apps/web`, `packages/contracts`, `programs/arena`) | Viktor | каркас + CI lint/build |
| P0.2 | `@arena/contracts` — усі типи з spec §13 + REST DTO + WS messages | обидва | published пакет, імпортиться скрізь |
| P0.3 | DB schema + міграції (Postgres) по §13 | Viktor | `migrate up` працює |
| P0.4 | API+WS контракт (OpenAPI + message catalog §S2) + **mock-сервер** | Viktor | FE може кодити без реального backend |
| P0.5 | Anchor program skeleton + IDL stub (інструкції без логіки) | Андрій | IDL генериться, FE/Payout мають типи |
| P0.6 | Узгодити S5 settlement DSL | обидва | зафіксований JSON-формат |

**Definition of done Phase 0:** frontend стартує проти мок-сервера; backend має порожні engine-модулі з типами; Anchor IDL білдиться.

---

## Backend track — Viktor

Всі блоки споживають/продюсять через S1/S3, тестуються юніт-тестами на синтетичних подіях (реальний фід не потрібен до B7/B1).

### B1. TxODDS Ingestion + WS Parser
**Теза:** окремий конектор, що читає live feed (WS), нормалізує у whitelisted `LiveEvent` (§4.1), розрізняє `provisional`/`confirmed`, веде match clock зі stoppage, публікує в S3.
- Вхід: TxODDS WS. Вихід: `LiveEvent` stream + persisted timeline.
- Ізоляція: за відсутності реального фіда — фікстури з записаного матчу (теж годують Replay Engine B8).
- DoD: програш фікстури дає коректний потік нормалізованих подій із правильними хвилинами.

### B2. Match State Engine
**Теза:** підписка на S3, тримає агрегований стан матчу (score, minute+stoppage, period, possession, shots, corners, cards, active window).
- Вхід: `LiveEvent`. Вихід: `MatchState` snapshot + diff-події.
- DoD: послідовність подій → детермінований стан; period transitions (`period_start/end`) коректні.

### B3. Round Engine
**Теза:** керує lifecycle раунду й таймінгом (§5): `pending → open(T−leadTime, ≥60s) → locked(T) → settled`. Обробляє halftime skip і stoppage по `period_start/end`.
- Залежить від: B2 (де ми в матчі), B5 (готове питання), S2 (push у gateway).
- Критично: lock рівно на window start; lead time конфігурований ≥60s.
- DoD: для записаного матчу генерує правильну послідовність вікон 00:00…90:00 з halftime skip.

### B4. Settlement Engine
**Теза:** чиста функція S5 + інтеграція: early settlement при confirmed події в `[T,T+5]`, інакше window-end. Маркує survived/eliminated, оновлює `Prediction.result`, `ArenaPlayer.status`.
- Залежить від: B1 (confirmed events), B3 (locked round). **Повністю unit-тестабельний окремо** через S5.
- DoD: тести на early/window-end/missed; ідемпотентність (подія двічі не елімінує двічі).

### B5. Question Generator
**Теза:** на open кожного раунду продюсить question text + `settlementCondition` (S5). Policy §4.2: natural, уникати тривіально вирішених на момент генерації; target тільки з whitelist.
- Вхід: `MatchState` + recent events. Вихід: question + S5 condition.
- MVP: rule/template-based (без LLM) → детерміновано й дешево; LLM опційно пізніше.
- DoD: для набору станів генерує валідні, не-тривіальні питання з коректною умовою.

### B6. Leaderboard Service
**Теза:** трекає active/eliminated, рахує score + tie-breaks (§7: speed → fewer misses → earlier join → shared), резолвить winner(s).
- Вхід: settlement-результати. Вихід: leaderboard snapshot + final winner list.
- DoD: тести на one-survivor, multi-survivor-by-score, full tie → shared.

### B7. Realtime Gateway + REST API
**Теза:** WS (fallback SSE) для push (round open/lock/settle, leaderboard, match state); REST для lobby/join/history. Реалізує S2 поверх моку P0.4.
- **Spectator privacy (§8):** живі відповіді не віддавати до lock; після lock — тільки агрегати.
- Залежить від: B2/B3/B4/B6.
- DoD: реальний клієнт проходить повний раунд по WS; контракт = мок із P0.4.

### B8. Replay Engine (demo)
**Теза:** програє записаний TxODDS-матч у Ingestion (B1) з тими ж правилами → демо без живого матчу. Контроль швидкості (×1…×N).
- Залежить від: B1 фікстури.
- DoD: повний матч від kickoff до winner у пришвидшеному режимі.

---

## On-chain track — Андрій (Solana / Anchor, devnet)

### C1. Arena Escrow + Entry Pass program
**Теза:** Anchor-програма. PDA на арену, інструкція `buy_entry` переводить fixed lamports у escrow PDA, мінтить/реєструє entry pass (proof of participation).
- Інструкції: `init_arena(entryFee)`, `buy_entry()`, (`refund()` — опц., див. open items).
- DoD: на devnet можна купити entry, escrow росте, подвійний entry заборонений.

### C2. Payout / Pool settlement
**Теза:** інструкція `settle_payout(winners[])` розподіляє escrow: winner-takes-all або рівний поділ при shared win (§7/§12). Authority — backend payout-ключ (PDA-gated).
- DoD: escrow коректно виплачується одному/кільком winners; не можна викликати двічі.

### C3. Winner badge + result hash
**Теза:** записати фінальний результат (hash leaderboard) on-chain + winner badge (PDA або simple NFT).
- DoD: badge видимий у гаманці; result hash верифікується.

### C4. Payout Service (backend ↔ chain bridge)
**Теза:** Node-сервіс: слухає фіналізацію leaderboard (B6), будує й підписує `settle_payout` tx, ретраї, трекає `Payout.status`. Тримає payout authority key (env/secret).
- Залежить від: C2 IDL (S4), B6 результат. **Мокає B6 через фікстуру winner-list.**
- DoD: дано winner-list → on-chain payout пройшов, `Payout` оновлено.

### C5. Wallet / Identity backend
**Теза:** verify wallet signature (sign-in with Solana), лінк `walletAddress` ↔ `User`, видача сесії. Gate на join/buy.
- Залежить від: P0.2 типи. Незалежний від ігрової логіки.
- DoD: підпис верифікується, сесія видається, повторний логін той самий User.

---

## Frontend track — split

React + Vite PWA, mobile-first. Wallet adapter (Solana wallet-adapter / mobile wallet через browser). Всі екрани кодяться проти моку P0.4.

| ID | Екран/модуль | Owner | Залежить |
|----|--------------|-------|----------|
| F1 | App shell, routing, PWA, **wallet adapter + connect** | Андрій | P0.5, C5 |
| F2 | Match Lobby + **Entry Pass purchase** (buy tx) | Андрій | C1, F1 |
| F3 | **Live Arena + Prediction Card** (realtime, countdown ≥60s до lock) | Viktor | B7 (мок P0.4) |
| F4 | Leaderboard + Spectator + Match Summary | Viktor | B7 |
| F5 | Winner / Payout screen (badge, claim/виплата) | Андрій | C2/C3, B6 |

**Контракт countdown (F3):** таймер рахує до `lockAt`, не показує «10–15с»; lead time ≥60s. Після lock UI блокує input.

---

## Залежності та критичний шлях

```
Phase 0 ──► усе інше

Backend critical path:  B1 → B2 → B3 → B4/B6 → B7 → (B8 demo)
                                    └ B5 паралельно (потрібен на B3.open)

Onchain critical path:  P0.5 → C1 → C2 → C4   (C3 паралельно; C5 рано, незалежно)

Frontend:               F1 → F2 (onchain)     ┐
                        F3 → F4 (realtime)     ┘ паралельно, через мок P0.4
                        F5 наприкінці (зводить onchain + leaderboard)
```

**Точки інтеграції (де треки сходяться):**
1. **I1:** Payout Service (C4) ↔ Leaderboard (B6) — winner-list контракт. До цього обидва на фікстурах.
2. **I2:** Frontend (F2/F5) ↔ Solana program (C1/C2) — через IDL S4.
3. **I3:** Frontend (F3/F4) ↔ Realtime Gateway (B7) — через S2; мок прибираємо в кінці.
4. **I4:** Wallet FE (F1) ↔ Identity backend (C5) — sign-in.

---

## Мілстоуни

### M1 — Vertical slice (довести наскрізний потік на 1 раунді)
- B1(фікстура)+B2+B3+B4+B7 мінімально; F3 показує 1 раунд по WS; C1 buy_entry на devnet; F1+F2 connect+buy.
- Демо: під'єднав гаманець → купив entry → відповів на 1 раунд → вилетів/вижив у realtime.

### M2 — Full game loop
- Усі backend engines (B5/B6/B8), повний матч через Replay, leaderboard, spectator privacy, C2/C4 payout, F4/F5.
- Демо: повний replay-матч від kickoff до winner + on-chain payout.

### M3 — Polish / pitch
- UX мобілки, edge cases (reconnect §9, stoppage/halftime), результат hash/badge C3, демо-сценарій.

---

## Open items (вирішити по ходу, не блокери)
- **Refund** (`refund()` C1 + `EntryPass.refunded`) — якщо матч/арена скасована або не зібрала гравців. Поки skip для MVP, але інструкцію закласти.
- **Event bus реалізація** S3: для MVP — in-process EventEmitter; Redis pub/sub якщо рознесемо ingestion в окремий процес.
- **Question Generator LLM** — після rule-based MVP; тоді whitelist + S5 лишаються тим самим контрактом.
- **Platform fee** — зараз 0%; параметр у `init_arena`.
- **Secrets:** payout authority key (C4) — env/secret manager, не в репо.

---

## Хто що бере (підсумок)
- **Viktor:** P0.1/P0.3/P0.4, B1–B8 (увесь backend core + realtime), F3+F4 (live arena, leaderboard, spectator).
- **Андрій:** P0.5, C1–C5 (Solana program + payout + wallet/identity), F1+F2+F5 (wallet connect, entry purchase, payout screen).
- **Разом:** P0.2 contracts, P0.6 settlement DSL, точки інтеграції I1–I4.
