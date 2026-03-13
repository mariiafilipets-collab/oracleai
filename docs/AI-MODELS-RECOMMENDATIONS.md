# Рекомендации по моделям для генерации событий (OracleAI Predict)

## Текущая связка (3 этапа)

| Этап | Назначение | Сейчас (env) | Роль |
|------|------------|---------------|------|
| **Retriever** | Поиск актуальной информации в сети | `OPENROUTER_RETRIEVER_MODEL` (sonar-pro) | Ищет новости/события по категории |
| **Normalizer** | Генерация 5 событий из контекста | `OPENROUTER_NORMALIZER_MODEL` (gemini-2.0-flash) | Превращает сырой контекст в JSON-события |
| **Arbiter** | Финальная проверка и источники | `OPENROUTER_ARBITER_MODEL` (gemini-2.0-flash) | QA, URLs, описания |
| **Resolve** | Проверка результата события | `OPENROUTER_RESOLVE_MODEL` (grok-4.1-fast) | Факт-чекинг исхода |

---

## Рекомендуемая связка «поиск → оформление»

Идея: **одна модель ищет**, **вторая строго оформляет** по нашим правилам и фильтрам (даты UTC, verifyAtUtc, категория, лимиты). Так меньше отбраковки и стабильнее формат.

### 1. Retriever (поиск) — максимальная актуальность

| Модель | Плюсы | Минусы | Когда ставить |
|--------|--------|--------|----------------|
| **perplexity/sonar-pro** | Глубокая поисковая выдача, мультишаговый поиск | Дороже, плата за поиск | Уже стоит, оставить как основной |
| **perplexity/sonar-pro-search** | Ещё сильнее заточена под search, agentic research | Дороже (≈$18/1k searches) | Если нужна максимальная актуальность и глубина |
| **x-ai/grok-4.1-fast:online** | Быстро, дёшево, есть web | Меньше «глубины», чем Sonar | Как fallback или основной при ограниченном бюджете |

**Рекомендация:** оставить **perplexity/sonar-pro** основным ретривером. Если бюджет позволяет — попробовать **sonar-pro-search** для ещё более релевантной выдачи.

### 2. Formatter / Normalizer (оформление по правилам)

Здесь важны не «креативность», а **строгое следование схеме**: UTC, verifyAtUtc, eventStartAtUtc (для SPORTS), категория, 1–30 дней, без today/tonight при horizon > 6h.

| Модель | Плюсы | Минусы |
|--------|--------|--------|
| **google/gemini-2.0-flash-001** | Дёшево, быстро, хорошо следует инструкциям, поддерживает structured output | Иногда «разъезжаются» даты |
| **google/gemini-2.5-flash-preview-05-20** | Новее, лучше инструкции | Может быть не везде на OpenRouter |
| **anthropic/claude-sonnet-4** | Очень хорошо следует правилам, structured output | Дороже |
| **openai/gpt-4o** | Отличный structured output, предсказуемый JSON | Самый дорогой |

**Рекомендация:**  
- Основной форматер: **google/gemini-2.0-flash-001** (уже используется как Normalizer).  
- Опционально завести отдельную переменную **OPENROUTER_FORMATTER_MODEL** и поставить **anthropic/claude-sonnet-4** или **openai/gpt-4o** только для этапа «оформление», если нужна максимальная точность по датам и полям.

### 3. Arbiter (финальная проверка)

Достаточно одной быстрой модели с хорошим следованием инструкциям:  
**google/gemini-2.0-flash-001** — оставить. При желании можно заменить на **claude-sonnet-4** для более жёсткой фильтрации и требований по источникам.

### 4. Resolve (проверка исхода)

Нужна модель с доступом к актуальным данным (поиск/онлайн):  
**x-ai/grok-4.1-fast** или **grok-4.1-fast:online** — оставить. Альтернатива: **perplexity/sonar-pro** для сложных/спортивных исходов.

---

## Варианты конфигурации (env)

### Вариант A — «максимальная актуальность» (поиск усилен)

```env
OPENROUTER_RETRIEVER_MODEL=perplexity/sonar-pro-search
OPENROUTER_NORMALIZER_MODEL=google/gemini-2.0-flash-001
OPENROUTER_ARBITER_MODEL=google/gemini-2.0-flash-001
OPENROUTER_RESOLVE_MODEL=x-ai/grok-4.1-fast
OPENROUTER_FALLBACK_MODEL=google/gemini-2.0-flash-001
```

### Вариант B — «максимальное качество оформления» (форматер — Claude)

```env
OPENROUTER_RETRIEVER_MODEL=perplexity/sonar-pro
OPENROUTER_NORMALIZER_MODEL=anthropic/claude-sonnet-4
OPENROUTER_FORMATTER_MODEL=anthropic/claude-sonnet-4
OPENROUTER_ARBITER_MODEL=google/gemini-2.0-flash-001
OPENROUTER_RESOLVE_MODEL=x-ai/grok-4.1-fast
OPENROUTER_FALLBACK_MODEL=google/gemini-2.0-flash-001
```

### Вариант C — «баланс цена/качество» (текущий + явные имена)

```env
OPENROUTER_RETRIEVER_MODEL=perplexity/sonar-pro
OPENROUTER_NORMALIZER_MODEL=google/gemini-2.0-flash-001
OPENROUTER_ARBITER_MODEL=google/gemini-2.0-flash-001
OPENROUTER_SEARCH_MODEL=x-ai/grok-4.1-fast
OPENROUTER_RESOLVE_MODEL=x-ai/grok-4.1-fast
OPENROUTER_FALLBACK_MODEL=google/gemini-2.0-flash-001
```

---

## Связка «одна ищет — вторая оформляет»

Логика уже реализована:

1. **searchPopularEvents(category)** вызывает **search()** → используется Retriever (Sonar/Grok).  
2. **generateCategoryPredictions(category, context)** вызывает **generate()** → используется Normalizer (Gemini/Claude). Контекст = сырая выдача ретривера.

Чтобы вторая модель **строго** следовала правилам и фильтрам:

- Явно прописать в системном промпте все ограничения (даты только UTC, окно 1–30 дней, verifyAtUtc обязателен, для SPORTS — eventStartAtUtc).
- Опционально: вызывать Normalizer с **OpenRouter Structured Outputs** (JSON Schema), чтобы ответ всегда был массивом объектов с полями `title`, `description`, `verifyAtUtc`, `eventStartAtUtc`, `category` и т.д. Поддерживают: Gemini, Claude, GPT-4o.

Добавление отдельной переменной **OPENROUTER_FORMATTER_MODEL** позволяет в будущем подставить модель только для этапа оформления (например Claude), не меняя Retriever и Arbiter.

---

## Краткий вывод

- **Более актуальные события:** усилить ретривер — оставить **perplexity/sonar-pro** или перейти на **sonar-pro-search** при наличии бюджета.  
- **Более качественное оформление (даты, фильтры):** оставить **Gemini 2.0 Flash** как Normalizer и усилить промпты; при необходимости поставить **Claude Sonnet 4** в **OPENROUTER_FORMATTER_MODEL** / **OPENROUTER_NORMALIZER_MODEL** и (опционально) включить Structured Output по JSON Schema для гарантированного формата.
