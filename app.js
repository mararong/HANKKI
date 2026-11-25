(function () {
  "use strict";

  const {
    meals, mealKeys, nutrients, nutrientKeys, reference, firstDate,
    dateKey, dateObject, isDate, changeDay, changeMonth, datesInPeriod,
    gramsOf, amountFor, summarize, valueOf, isComplete, averageOf,
    mainContributor, entriesIn, findFoods,
  } = window.HankkiNutrition;
  const foods = window.HankkiFoods;
  const catalog = new Map(foods.map(food => [food.id, food]));
  const storageKey = "hankki.meal-journal.v1";
  const pages = ["today", "record", "report"];
  const periods = { day: "일간", week: "주간", month: "월간" };
  const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
  const longDate = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC",
  });
  const shortDate = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric", day: "numeric", timeZone: "UTC",
  });
  const view = document.getElementById("view");
  const customDialog = document.getElementById("custom-food");
  const drafts = new Map();
  const hash = location.hash.slice(1);
  const state = {
    view: pages.includes(hash) ? hash : "today",
    date: dateKey(),
    meal: "breakfast",
    period: "day",
    nutrient: "energy",
    journal: { version: 1, days: {} },
    storageProblem: false,
  };
  let announcementTimer;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    ));
  }

  function icon(name, size = 20) {
    return `<img class="icon" src="./assets/${name}.png" width="${size}" height="${size}" alt="">`;
  }

  function id() {
    return [...crypto.getRandomValues(new Uint32Array(3))].join("-");
  }

  function format(value) {
    return value === null ? "—" : numberFormat.format(value);
  }

  function quantity(value, key) {
    return value === null ? "—" : `${format(value)} ${nutrients[key].unit}`;
  }

  function dayOf(date = state.date) {
    return state.journal.days[date] || { completed: false, meals: {} };
  }

  function sameEntries(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function entryIsValid(entry) {
    const food = entry?.food;
    if (typeof entry?.id !== "string" || !food || typeof food.id !== "string" ||
        typeof food.name !== "string" || gramsOf(entry.grams) === null) return false;
    return nutrientKeys.every(key => {
      const value = food.values?.[key];
      return (key !== "energy" && value === null) || (Number.isFinite(value) && value >= 0);
    });
  }

  function readJournal() {
    if (state.storageProblem) return;
    try {
      const data = JSON.parse(localStorage.getItem(storageKey));
      if (data === null) {
        state.journal = { version: 1, days: {} };
        return;
      }
      const valid = data.version === 1 && data.days && typeof data.days === "object" &&
        !Array.isArray(data.days) && Object.entries(data.days).every(([date, day]) =>
          isDate(date) && typeof day?.completed === "boolean" && day.meals &&
          mealKeys.every(key => day.meals[key] === undefined ||
            (Array.isArray(day.meals[key]) && day.meals[key].every(entryIsValid))));
      if (!valid) throw new Error("Unsupported journal data");
      state.journal = data;
    } catch {
      state.storageProblem = true;
    }
  }

  function saveDay(date, day) {
    if (entriesIn(day).length) state.journal.days[date] = day;
    else delete state.journal.days[date];
    if (state.storageProblem) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.journal));
    } catch {
      state.storageProblem = true;
    }
  }

  function refreshStorageNotice() {
    document.getElementById("storage-notice").hidden = !state.storageProblem;
  }

  function announce(message) {
    const toast = document.getElementById("announcement");
    toast.textContent = message;
    clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => { toast.textContent = ""; }, 3400);
  }

  function pageHeader(title, description = "") {
    const today = dateKey();
    return `
      <header class="page-header">
        <div>
          <h1 id="page-title" tabindex="-1">${title}</h1>
          ${description ? `<p class="page-description">${description}</p>` : ""}
        </div>
        <div class="date-picker">
          <label for="record-date">${icon("calendar", 18)}<span>기록 날짜</span></label>
          <input id="record-date" type="date" value="${state.date}" min="${firstDate}" max="${today}" required>
          ${state.date < today ? '<button class="small-button" data-action="today-date">오늘</button>' : ""}
        </div>
      </header>`;
  }

  function missingLabel(summary, key) {
    if (!summary.count || isComplete(summary, key)) return "";
    return ` <span class="partial">${summary.known[key] ? "일부 기록" : "자료 없음"}</span>`;
  }

  function renderHome() {
    const day = dayOf();
    const summary = summarize(entriesIn(day));
    const coreMeals = mealKeys.slice(0, 3);
    const recorded = coreMeals.filter(key => day.meals[key]?.length).length;
    const suggestedMeal = coreMeals.find(key => !day.meals[key]?.length) ?? state.meal;
    const mealCards = mealKeys.map(key => {
      const entries = day.meals[key] || [];
      const value = valueOf(summarize(entries), "energy");
      const names = entries.map(entry => entry.food.name).join(" · ");
      return `
        <button class="meal-row" data-action="edit-meal" data-meal="${key}">
          <span class="meal-icon">${icon(meals[key].icon)}</span>
          <span class="meal-copy"><strong>${meals[key].label}</strong>
            <span>${entries.length ? escapeHtml(names) : key === "snack" ? "선택 기록" : "기록 없음"}</span>
          </span>
          <span class="meal-result">${entries.length ? quantity(value, "energy") : '<span class="plus">＋</span>'}</span>
        </button>`;
    }).join("");
    const macros = ["carbs", "protein", "fat"];
    const mass = macros.reduce((sum, key) => sum + summary.totals[key], 0);
    const nutrientsCards = macros.map(key => {
      const fraction = mass ? summary.totals[key] / mass * 100 : 0;
      return `<div class="macro ${key}">
        <span class="muted">${nutrients[key].label}</span>
        <strong>${format(valueOf(summary, key))} <small>g</small></strong>
        <span class="macro-track" aria-hidden="true"><span style="width:${fraction}%"></span></span>
        ${missingLabel(summary, key)}
      </div>`;
    }).join("");
    return `
      ${pageHeader(state.date === dateKey() ? "오늘의 식단" : "하루 식단", longDate.format(dateObject(state.date)))}
      <div class="dashboard">
        <div class="dashboard-primary">
          <section class="energy-card" aria-labelledby="energy-heading">
            <div class="section-head">
              <h2 id="energy-heading">하루 섭취 열량</h2>
              <span class="status-pill">${day.completed ? "기록 완료" : "기록 " + recorded + "/3끼니"}</span>
            </div>
            <div class="hero-number" id="daily-energy">${format(valueOf(summary, "energy"))} <span>kcal</span></div>
            <div class="meal-strip" aria-label="아침 점심 저녁 기록 상태">
              ${coreMeals.map(key => `<span class="${day.meals[key]?.length ? "marked" : ""}">
                <i aria-hidden="true"></i>${day.meals[key]?.length ? "✓ " : ""}${meals[key].label}
              </span>`).join("")}
            </div>
          </section>
          <section class="nutrient-section" aria-labelledby="daily-nutrition-heading">
            <div class="section-head"><h2 id="daily-nutrition-heading">하루 영양소</h2><span class="muted">섭취량 합계</span></div>
            <div class="macro-grid">${nutrientsCards}</div>
            <dl class="other-nutrients surface">${["fiber", "sodium"].map(key => `
              <div><dt>${nutrients[key].label}${missingLabel(summary, key)}</dt>
                <dd>${quantity(valueOf(summary, key), key)}</dd></div>`).join("")}</dl>
          </section>
        </div>
        <section class="surface meal-card" aria-labelledby="meal-heading">
          <div class="section-head">
            <h2 id="meal-heading">끼니별 기록</h2><span class="muted">${summary.count}개 음식</span>
          </div>
          <div class="meals">${mealCards}</div>
          <button class="button primary full" data-action="edit-meal" data-meal="${suggestedMeal}">＋ 음식 기록하기</button>
          ${day.completed
            ? '<button class="button secondary full" data-action="daily-report">일간 리포트 보기</button>'
            : '<button class="button secondary full" data-action="complete-day"' +
              (summary.count ? "" : " disabled") + '>하루 기록 완료</button>'}
          ${day.completed
            ? '<button class="text-button finish-cancel" data-action="reopen-day">완료 취소</button>'
            : '<p class="hint finish-note">하루 입력을 마치면 리포트에서 개선점을 확인할 수 있어요.</p>'}
        </section>
      </div>`;
  }

  function draftKey() {
    return state.date + "/" + state.meal;
  }

  function currentDraft() {
    const key = draftKey();
    if (!drafts.has(key)) {
      const base = dayOf().meals[state.meal] || [];
      drafts.set(key, {
        base, entries: base.map(entry => ({ ...entry, grams: String(entry.grams) })),
        query: "", replacing: null, allResults: false,
      });
    }
    return drafts.get(key);
  }

  function searchResults(draft) {
    const matches = findFoods(foods, draft.query);
    const limit = draft.allResults ? matches.length : 6;
    const label = draft.replacing ? "바꿀 음식 선택" : draft.query.trim() ? "검색 결과" : "자주 찾는 음식";
    return `
      <div class="section-head results-head"><h3>${label}</h3><span class="muted">100 g 기준</span></div>
      ${matches.length ? `<div class="food-results">${matches.slice(0, limit).map(food => `
        <button class="food-result" data-action="add-food" data-food="${food.id}" aria-label="${escapeHtml(food.name)} ${draft.replacing ? "선택" : "추가"}">
          <span><strong>${escapeHtml(food.name)}</strong>
            <small>${food.category} · ${quantity(food.values.energy, "energy")}${food.values.protein === null ? "" : " · 단백질 " + quantity(food.values.protein, "protein")}</small>
          </span>
          <span class="plus" aria-hidden="true">${draft.replacing ? "✓" : "＋"}</span>
        </button>`).join("")}</div>` : '<p class="empty compact">찾은 음식이 없어요. 다른 음식 이름으로 검색하거나 영양표시를 입력해 추가하세요.</p>'}
      ${matches.length > limit ? `<button class="text-button more-results" data-action="more-results">${draft.query.trim() ? "검색 결과 모두 보기" : "음식 목록 보기"} <small>${matches.length}개</small></button>` : ""}
      ${draft.replacing ? '<button class="text-button" data-action="cancel-replace">음식 변경 취소</button>' : ""}
      <button class="button secondary full" data-action="external-search">식약처 음식 더 찾기</button>
      <div id="external-results" aria-live="polite"></div>
      <button class="button secondary full manual-button" data-action="custom-food">영양표시로 직접 추가</button>`;
  }

  function editFoodRow(entry) {
    const food = entry.food;
    const name = escapeHtml(food.name);
    const entryId = escapeHtml(entry.id);
    const source = catalog.get(food.id)?.source;
    return `
      <div class="draft-entry" data-entry="${entryId}">
        <div class="section-head">
          <div class="entry-name"><strong>${name}</strong>
            <span class="muted">${food.serving ? "1회 참고량 " + format(food.serving) + " g" : "100 g당 " + quantity(food.values.energy, "energy")}</span>
          </div>
          <strong class="entry-energy" data-energy>${quantity(amountFor(entry, "energy"), "energy")}</strong>
        </div>
        <div class="weight-row">
          <label for="weight-${entryId}">먹은 중량</label>
          <div class="weight-control">
            <button class="weight-step" type="button" data-action="weight-step" data-delta="-10" aria-label="${name} 10 g 줄이기">−</button>
            <div class="weight-field">
              <input id="weight-${entryId}" data-weight type="number" inputmode="decimal" step="any" min="0.1" max="10000"
                aria-label="${name} 먹은 중량 (g)" aria-describedby="weight-error-${entryId}"
                value="${escapeHtml(entry.grams)}" required><span aria-hidden="true">g</span>
            </div>
            <button class="weight-step" type="button" data-action="weight-step" data-delta="10" aria-label="${name} 10 g 늘리기">＋</button>
          </div>
        </div>
        <p id="weight-error-${entryId}" class="error" data-weight-error hidden>0.1~10,000 g 사이로 입력해 주세요.</p>
        <div class="entry-actions">
          ${food.serving ? '<button type="button" class="text-button" data-action="one-serving">1회 분량 적용</button>' : ""}
          <button type="button" class="text-button" data-action="replace-food" aria-label="${name} 다른 음식으로 변경">음식 변경</button>
          <button type="button" class="text-button" data-action="remove-food" aria-label="${name} 삭제">삭제</button>
          ${source ? `<a class="source-link" href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">성분 자료</a>` : ""}
        </div>
      </div>`;
  }

  function draftSummary(draft) {
    const summary = summarize(draft.entries);
    return `
      <div class="section-head"><strong>이번 식사</strong><strong class="meal-energy">${quantity(valueOf(summary, "energy"), "energy")}</strong></div>
      <dl class="meal-nutrients">${nutrientKeys.slice(1).map(key => `<div><dt>${nutrients[key].label}</dt>
        <dd>${quantity(valueOf(summary, key), key)}${missingLabel(summary, key)}</dd></div>`).join("")}</dl>`;
  }

  function renderEditor() {
    const draft = currentDraft();
    return `
      <div class="editor-context">
        ${pageHeader("식단 기록", longDate.format(dateObject(state.date)))}
        <div class="meal-tabs segmented" role="group" aria-label="기록할 끼니">
          ${mealKeys.map(key => `<button data-action="select-meal" data-meal="${key}" aria-pressed="${key === state.meal}">
            ${key === state.meal ? '<span class="selected-check" aria-hidden="true">✓</span>' : ""}${meals[key].label}
          </button>`).join("")}
        </div>
      </div>
      <div class="editor-layout">
        <section class="surface search-panel" aria-labelledby="search-heading">
          <h2 id="search-heading">무엇을 드셨나요?</h2>
          <label class="search-box" for="food-search">${icon("search")}
            <span class="sr-only">음식 이름 검색</span>
            <input id="food-search" type="search" value="${escapeHtml(draft.query)}" placeholder="음식 이름을 검색하세요" autocomplete="off">
          </label>
          <div id="search-results">${searchResults(draft)}</div>
        </section>
        <section class="surface draft-panel" aria-labelledby="draft-heading">
          <div class="section-head"><h2 id="draft-heading">${meals[state.meal].label}에 선택한 음식</h2><span id="draft-count" class="pill"></span></div>
          <div id="draft-entries"></div>
          <div class="meal-summary" id="draft-summary"></div>
          <div id="draft-error" class="error" role="alert" hidden></div>
          <button class="button primary full" id="save-meal" data-action="save-meal">
            ${meals[state.meal].label} ${draft.base.length ? "수정 저장" : "기록하기"}
          </button>
          <button class="text-button" id="reload-meal" data-action="reload-meal" hidden>저장된 끼니 불러오기</button>
        </section>
      </div>`;
  }

  function updateDraftSummary(draft = currentDraft()) {
    document.getElementById("draft-summary").innerHTML = draftSummary(draft);
    document.getElementById("save-meal").disabled = !draft.entries.length && !draft.base.length;
  }

  function updateRows(draft = currentDraft()) {
    document.getElementById("draft-count").textContent = draft.entries.length + "개";
    document.getElementById("draft-entries").innerHTML = draft.entries.map(editFoodRow).join("") ||
      '<p class="empty">먹은 음식을 고르고 양을 입력하세요.</p>';
    for (const row of document.querySelectorAll("[data-entry]")) {
      const entry = draft.entries.find(item => item.id === row.dataset.entry);
      updateWeightDisplay(row, entry);
    }
    updateDraftSummary(draft);
  }

  function updateSearch(draft = currentDraft()) {
    document.getElementById("search-results").innerHTML = searchResults(draft);
  }

  function updateWeightDisplay(row, entry) {
    const invalid = gramsOf(entry.grams) === null;
    row.querySelector("[data-energy]").textContent = quantity(amountFor(entry, "energy"), "energy");
    row.querySelector("[data-weight-error]").hidden = !invalid;
    row.querySelector("[data-weight]").setAttribute("aria-invalid", String(invalid));
  }

  function periodData() {
    return datesInPeriod(state.date, state.period, dateKey()).filter(date => date >= firstDate).map(date => {
      const day = dayOf(date);
      const entries = entriesIn(day);
      return { date, entries, completed: day.completed, summary: summarize(entries) };
    });
  }

  function chartScale(points, key) {
    const largest = Math.max(0, ...points.map(point => valueOf(point.summary, key) ?? 0));
    if (!largest) return 1;
    const unit = 10 ** Math.floor(Math.log10(largest));
    const top = [1, 2, 4, 5, 8, 10].find(step => step * unit >= largest);
    return top * unit;
  }

  function chart(days) {
    const isDay = state.period === "day";
    const key = state.nutrient;
    const points = isDay ? mealKeys.map(meal => ({
      label: meals[meal].label, summary: summarize(dayOf().meals[meal] || []),
    })) : days.map(day => ({
      ...day, label: state.period === "week" ? shortDate.format(dateObject(day.date)) :
        String(dateObject(day.date).getUTCDate()),
    }));
    const scale = chartScale(points, key);
    const columns = points.map(point => {
      const value = valueOf(point.summary, key);
      const missing = value === null;
      const partial = !missing && !isComplete(point.summary, key);
      const label = (isDay ? point.label : longDate.format(dateObject(point.date))) + " " +
        (missing ? (point.summary.count ? "자료 없음" : "기록 없음") :
          quantity(value, key) + (partial ? " 일부 기록" : ""));
      const content = `<span class="bar-slot"><span class="bar" style="--fill:${missing ? 0 : value / scale * 100}%"></span></span>
        <span class="chart-label">${point.label}${isDay ? `<small>${quantity(value, key)}</small>` : ""}</span>`;
      const cls = "chart-column" + (missing ? " no-value" : "") + (partial ? " partial-value" : "") +
        (point.date === state.date ? " selected" : "");
      return isDay ? `<div class="${cls}" role="img" aria-label="${label}" title="${label}">${content}</div>` :
        `<button class="${cls}" data-action="chart-day" data-date="${point.date}" aria-label="${label} 자세히 보기" title="${label}">${content}</button>`;
    }).join("");
    return `
      <div class="chart-scroll" tabindex="0" aria-label="${nutrients[key].label} 그래프">
        <div class="chart ${points.length > 10 ? "long-chart" : ""}" style="--columns:${points.length}">
          <div class="axis" aria-hidden="true"><span>${format(scale)}</span><span>${format(scale / 2)}</span><span>0</span></div>
          <div class="chart-columns">${columns}</div>
        </div>
      </div>`;
  }

  function compareTips(days) {
    const complete = days.filter(day => day.completed);
    if (!complete.length) {
      const action = state.period === "day" && days[0]?.entries.length
        ? '<button class="button secondary" data-action="complete-day">하루 기록 완료</button>' : "";
      return `<p class="hint">하루 기록을 완료하면 다음 식사 팁이 표시돼요.</p>${action}`;
    }
    const fiber = averageOf(complete, "fiber");
    const sodium = averageOf(complete, "sodium");
    const tips = [];
    if (fiber.value !== null && fiber.value < reference.fiber) {
      tips.push(["식이섬유 챙기기", "다음 끼니에 채소 반찬이나 과일을 곁들여 보세요."]);
    }
    if (sodium.value !== null && sodium.value > reference.sodium) {
      const contributor = mainContributor(sodium.days, "sodium");
      if (contributor) {
        const [name] = contributor;
        const tip = /국$|탕$|찌개|라면|라멘/.test(name)
          ? "국물은 따로 덜고 건더기와 함께 먹을 양을 골라 보세요."
          : "다음 식사에 소스나 양념을 따로 곁들여 보세요.";
        tips.push(["나트륨이 많이 들어온 음식 확인", `${escapeHtml(name)}에서 들어온 나트륨이 가장 많았어요. ${tip}`]);
      }
    }
    const comparisonRows = [fiber, sodium].map((result, i) => {
      const key = i ? "sodium" : "fiber";
      const measured = result.value === null ? "비교 자료 없음" : quantity(result.value, key);
      return `<div><dt>${nutrients[key].label}</dt><dd>${measured} <span>· 기준 ${quantity(reference[key], key)}</span>
        ${state.period !== "day" && result.days.length ? `<span> · ${result.days.length}일</span>` : ""}</dd></div>`;
    }).join("");
    return `
      <p class="hint">${state.period === "day" ? "완료한 하루 기록" : "완료한 날의 하루 평균"}과 1일 영양표시 기준치를 비교했어요.</p>
      <dl class="comparison">${comparisonRows}</dl>
      ${tips.map(([title, detail]) => `<div class="tip"><strong>${title}</strong><p>${detail}</p></div>`).join("")}
      ${!tips.length && fiber.value !== null && sodium.value !== null
        ? '<p class="tip">다음 식사에서도 여러 종류의 식품을 골고루 곁들여 보세요.</p>' : ""}
      ${fiber.value === null || sodium.value === null ? '<p class="hint">성분값이 모두 기록된 날을 기준으로 비교해요.</p>' : ""}
      ${state.period === "day" ? '<button class="text-button finish-cancel" data-action="reopen-day">완료 취소</button>' : ""}`;
  }

  function renderReport() {
    const days = periodData();
    const isDay = state.period === "day";
    const day = days[0];
    const label = isDay ? "끼니별 섭취량" : "날짜별 섭취량";
    const key = state.nutrient;
    const average = averageOf(days, key);
    const mainValue = isDay ? valueOf(day.summary, key) : average.value;
    const loggedDays = days.filter(item => item.entries.length);
    const periodLabel = isDay ? longDate.format(dateObject(state.date)) :
      shortDate.format(dateObject(days[0].date)) + " – " + shortDate.format(dateObject(days.at(-1).date));
    const amountRows = nutrientKeys.map(nutrient => {
      const mean = isDay ? null : averageOf(days, nutrient);
      const value = isDay ? valueOf(day.summary, nutrient) : mean.value;
      return `<div><dt>${nutrients[nutrient].label}</dt><dd>${quantity(value, nutrient)}
        ${isDay ? missingLabel(day.summary, nutrient) : mean.days.length && mean.days.length < loggedDays.length
          ? `<span class="partial">${mean.days.length}일</span>` : ""}</dd></div>`;
    }).join("");
    const nextDisabled = state.period === "month" ? state.date.slice(0, 7) === dateKey().slice(0, 7) : state.date === dateKey();
    return `
      ${pageHeader("나의 식습관 리포트")}
      <div class="report-context">
        <div class="segmented period-tabs" role="group" aria-label="리포트 기간">
          ${Object.entries(periods).map(([period, name]) => `<button data-action="period" data-period="${period}" aria-pressed="${period === state.period}">${name}</button>`).join("")}
        </div>
        <div class="period-control">
          <button class="small-button" data-action="shift-period" data-direction="-1"${state.date === firstDate ? " disabled" : ""}>이전</button>
          <span>${periodLabel}</span>
          <button class="small-button" data-action="shift-period" data-direction="1"${nextDisabled ? " disabled" : ""}>다음</button>
        </div>
      </div>
      <div class="report-layout">
        <div class="report-primary">
          <section class="surface chart-card" aria-labelledby="graph-title">
            <div class="section-head"><h2 id="graph-title">${label}</h2>
              <label class="sr-only" for="report-nutrient">표시할 영양성분</label>
              <select id="report-nutrient">${nutrientKeys.map(n => `<option value="${n}"${n === key ? " selected" : ""}>${nutrients[n].label}</option>`).join("")}</select>
            </div>
            <div class="chart-total"><span class="muted">${isDay ? "하루 합계" : "기록한 날 평균"}</span>
              <strong>${format(mainValue)} <small>${nutrients[key].unit}</small></strong>
              ${isDay ? missingLabel(day.summary, key) : `<span class="muted">${average.days.length}일 집계</span>`}</div>
            ${chart(days)}
            <p class="hint chart-note">${isDay ? "‘—’는 빠진 기록 또는 성분 자료를 뜻해요." : "날짜를 선택하면 그날의 기록을 볼 수 있어요."}</p>
            ${!loggedDays.length ? '<p class="hint chart-note">이 기간에 기록한 음식이 없어요.</p>' : ""}
          </section>
          <section class="tips-card" aria-labelledby="tips-title">
            <h2 id="tips-title">다음 한 끼는 이렇게</h2>
            ${compareTips(days)}
          </section>
        </div>
        <div class="report-secondary">
          <section class="surface amounts-card" aria-labelledby="amount-title">
            <div class="section-head"><h2 id="amount-title">영양소별 섭취량</h2><span class="muted">${isDay ? "하루 합계" : "하루 평균"}</span></div>
            <dl class="amounts">${amountRows}</dl>
            ${!isDay ? '<p class="hint">기록과 성분값이 모두 있는 날로 평균을 계산해요.</p>' : ""}
            ${isDay && !day.entries.length ? '<button class="button primary full" data-action="edit-meal" data-meal="breakfast">음식 기록하기</button>' : ""}
          </section>
          <details class="surface sources">
            <summary>계산 기준과 자료 출처</summary>
            <p>음식별 100 g당 성분값에 먹은 양(g)을 곱하고 100으로 나눠 계산해요. 조리법에 따라 달라질 수 있는 추정치예요.</p>
            <p>리포트의 기준치는 영양표시를 비교할 때 쓰는 공통 참고값이에요. 성분값이 빠진 음식은 해당 성분 합계에서 제외하고 표시해요.</p>
            <a href="https://various.foodsafetykorea.go.kr/nutrient/" target="_blank" rel="noopener noreferrer">K-FIND 식품영양성분 데이터베이스</a>
            <a href="https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&amp;flSeq=156389317&amp;gubun=" target="_blank" rel="noopener noreferrer">1일 영양성분 기준치 (별표 5)</a>
          </details>
        </div>
      </div>`;
  }

  function render() {
    refreshStorageNotice();
    for (const link of document.querySelectorAll(".navigation [data-view]")) {
      if (link.dataset.view === state.view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    document.body.dataset.page = state.view;
    const renderPage = { today: renderHome, record: renderEditor, report: renderReport }[state.view];
    view.innerHTML = renderPage();
    if (state.view === "record") updateRows();
  }

  function goTo(page) {
    state.view = page;
    if (location.hash !== "#" + page) history.replaceState(null, "", "#" + page);
    render();
    window.scrollTo(0, 0);
    document.getElementById("page-title").focus({ preventScroll: true });
  }

  function addOrReplace(food) {
    const draft = currentDraft();
    const existing = draft.entries.find(entry => entry.id === draft.replacing);
    const snapshot = { id: food.id, name: food.name, serving: food.serving, values: food.values };
    const entry = existing || { id: id(), grams: String(food.serving ?? 100) };
    entry.food = snapshot;
    if (!existing) draft.entries.push(entry);
    draft.replacing = null;
    updateSearch(draft);
    updateRows(draft);
    document.getElementById("weight-" + entry.id)?.focus();
    announce(food.name + (existing ? "으로 바꿨어요." : "을(를) 추가했어요."));
  }

  function saveMeal() {
    const draft = currentDraft();
    const invalid = draft.entries.find(entry => gramsOf(entry.grams) === null);
    if (invalid) {
      document.getElementById("weight-" + invalid.id)?.focus();
      return;
    }
    readJournal();
    refreshStorageNotice();
    const day = dayOf();
    if (!sameEntries(draft.base, day.meals[state.meal] || [])) {
      const error = document.getElementById("draft-error");
      error.textContent = "다른 탭에서 이 끼니가 바뀌었어요. 저장된 끼니를 불러와 확인해 주세요.";
      error.hidden = false;
      document.getElementById("reload-meal").hidden = false;
      return;
    }
    const updated = { ...day, meals: { ...day.meals } };
    if (draft.entries.length) {
      updated.meals[state.meal] = draft.entries.map(entry => ({ ...entry, grams: gramsOf(entry.grams) }));
    } else {
      delete updated.meals[state.meal];
    }
    saveDay(state.date, updated);
    drafts.delete(draftKey());
    const label = meals[state.meal].label;
    goTo("today");
    announce(label + " 기록을 저장했어요.");
  }

  function setCompletion(completed) {
    readJournal();
    const day = dayOf();
    if (!entriesIn(day).length) {
      render();
      return;
    }
    saveDay(state.date, { ...day, completed });
    if (completed) {
      state.period = "day";
      goTo("report");
      announce("하루 기록을 완료했어요.");
    } else {
      render();
      announce("하루 기록을 다시 열었어요.");
    }
  }

  function editDate(date) {
    if (isDate(date) && date >= firstDate && date <= dateKey()) state.date = date;
    render();
    document.getElementById("record-date").focus({ preventScroll: true });
  }

  function stepPeriod(direction) {
    const date = state.period === "month" ? changeMonth(state.date, direction) :
      changeDay(state.date, direction * (state.period === "week" ? 7 : 1));
    editDate(date > dateKey() ? dateKey() : date < firstDate ? firstDate : date);
  }

  function rowAction(button) {
    const row = button.closest("[data-entry]");
    const draft = currentDraft();
    const entry = draft.entries.find(item => item.id === row?.dataset.entry);
    if (!entry) return;
    const action = button.dataset.action;
    if (action === "remove-food") {
      draft.entries = draft.entries.filter(item => item.id !== entry.id);
      if (draft.replacing === entry.id) draft.replacing = null;
      updateSearch(draft);
      updateRows(draft);
      document.getElementById("food-search").focus({ preventScroll: true });
      announce(entry.food.name + "을(를) 선택 목록에서 뺐어요.");
      return;
    }
    if (action === "replace-food") {
      draft.replacing = entry.id;
      draft.query = "";
      draft.allResults = false;
      const search = document.getElementById("food-search");
      search.value = "";
      updateSearch(draft);
      search.focus();
      return;
    }
    const input = row.querySelector("[data-weight]");
    const grams = action === "one-serving" ? entry.food.serving : Math.max(0.1, Math.min(
      10000, Math.round(((gramsOf(input.value) ?? 100) + Number(button.dataset.delta)) * 100) / 100,
    ));
    input.value = String(grams);
    entry.grams = input.value;
    updateWeightDisplay(row, entry);
    updateDraftSummary(draft);
  }

  async function externalSearch() {
    const output = document.getElementById("external-results");
    const term = currentDraft().query.trim();
    if (!term) {
      output.textContent = "검색창에 음식 이름을 먼저 입력하세요.";
      return;
    }
    const serverHint = "외부 검색은 README에 따라 인증키를 설정하고 run.py로 실행한 주소에서 사용할 수 있어요.";
    if (location.protocol === "file:") {
      output.textContent = serverHint;
      return;
    }
    output.textContent = "식약처에서 검색 중…";
    try {
      const response = await fetch("./api/foods?q=" + encodeURIComponent(term));
      if (!response.headers.get("content-type")?.includes("application/json")) {
        output.textContent = serverHint;
        return;
      }
      const result = await response.json();
      if (!response.ok) {
        output.textContent = result.error || "잠시 후 다시 검색해 주세요.";
        return;
      }
      if (!output.isConnected) return;
      output.replaceChildren();
      for (const food of result.foods) {
        catalog.set(food.id, food);
        const button = document.createElement("button");
        button.className = "food-result";
        button.dataset.action = "add-food";
        button.dataset.food = food.id;
        button.textContent = food.name + " · " + quantity(food.values.energy, "energy") + " / 100 g";
        output.append(button);
      }
      if (!result.foods.length) output.textContent = "중량 기준과 열량이 확인되는 결과가 없어요. 다른 이름으로 검색해 보세요.";
    } catch {
      output.textContent = "연결을 확인한 후 다시 검색해 주세요.";
    }
  }

  const actions = {
    "external-search": externalSearch,
    "edit-meal": button => { state.meal = button.dataset.meal; goTo("record"); },
    "select-meal": button => {
      state.meal = button.dataset.meal;
      render();
      view.querySelector('[data-action="select-meal"][aria-pressed="true"]').focus({ preventScroll: true });
    },
    "today-date": () => editDate(dateKey()),
    "add-food": button => addOrReplace(catalog.get(button.dataset.food)),
    "more-results": () => {
      currentDraft().allResults = true;
      updateSearch();
      const newResult = view.querySelectorAll(".food-result")[6];
      newResult?.focus({ preventScroll: true });
    },
    "cancel-replace": () => { currentDraft().replacing = null; updateSearch(); },
    "save-meal": saveMeal,
    "reload-meal": () => { drafts.delete(draftKey()); render(); },
    "complete-day": () => setCompletion(true),
    "reopen-day": () => setCompletion(false),
    "daily-report": () => { state.period = "day"; goTo("report"); },
    "period": button => {
      state.period = button.dataset.period;
      render();
      view.querySelector('[data-action="period"][aria-pressed="true"]').focus({ preventScroll: true });
    },
    "shift-period": button => stepPeriod(Number(button.dataset.direction)),
    "chart-day": button => { state.date = button.dataset.date; state.period = "day"; goTo("report"); },
    "weight-step": rowAction,
    "one-serving": rowAction,
    "replace-food": rowAction,
    "remove-food": rowAction,
    "custom-food": () => {
      document.getElementById("custom-form").reset();
      document.getElementById("custom-error").hidden = true;
      customDialog.showModal();
    },
    "close-custom": () => customDialog.close(),
  };

  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-view], .brand");
    if (nav) {
      event.preventDefault();
      goTo(nav.dataset.view || "today");
      return;
    }
    const button = event.target.closest("button[data-action]");
    if (button) actions[button.dataset.action]?.(button);
  });

  view.addEventListener("input", event => {
    const input = event.target;
    if (input.id === "food-search") {
      const draft = currentDraft();
      draft.query = input.value;
      draft.allResults = false;
      updateSearch(draft);
    }
    if (input.matches("[data-weight]")) {
      const row = input.closest("[data-entry]");
      const draft = currentDraft();
      const entry = draft.entries.find(item => item.id === row.dataset.entry);
      entry.grams = input.value;
      updateWeightDisplay(row, entry);
      updateDraftSummary(draft);
    }
  });

  view.addEventListener("change", event => {
    const input = event.target;
    if (input.id === "record-date") {
      if (input.validity.valid) editDate(input.value);
      else {
        input.value = state.date;
        announce("오늘까지의 날짜를 선택해 주세요.");
      }
    }
    if (input.id === "report-nutrient") {
      state.nutrient = input.value;
      render();
      document.getElementById("report-nutrient").focus({ preventScroll: true });
    }
  });

  document.getElementById("custom-nutrients").innerHTML = nutrientKeys.map(key => `
    <label class="field">${nutrients[key].label} (${nutrients[key].unit})
      <input name="${key}" type="number" inputmode="decimal" min="0" step="any"
        ${key === "energy" ? 'required placeholder="필수"' : 'placeholder="선택"'}>
    </label>`).join("");

  document.getElementById("custom-form").addEventListener("submit", event => {
    event.preventDefault();
    const inputs = new FormData(event.currentTarget);
    const basis = gramsOf(inputs.get("basis"));
    const name = inputs.get("name").trim();
    const error = document.getElementById("custom-error");
    if (!name || !basis) {
      error.textContent = "음식 이름과 영양표시의 기준 중량을 확인해 주세요.";
      error.hidden = false;
      return;
    }
    const values = Object.fromEntries(nutrientKeys.map(key => {
      const value = inputs.get(key);
      return [key, value === "" ? null : Number(value) * 100 / basis];
    }));
    const maxima = { energy: 1000, carbs: 100, protein: 100, fat: 100, fiber: 100, sodium: 100000 };
    if (nutrientKeys.some(key => values[key] !== null &&
        (!Number.isFinite(values[key]) || values[key] > maxima[key]))) {
      error.textContent = "성분량과 단위를 다시 확인해 주세요.";
      error.hidden = false;
      return;
    }
    customDialog.close();
    addOrReplace({ id: "custom-" + id(), name, serving: basis, values });
  });

  window.addEventListener("storage", event => {
    if (event.key !== storageKey && event.key !== null) return;
    readJournal();
    if (state.view !== "record") render();
    else refreshStorageNotice();
  });

  readJournal();
  render();
})();
