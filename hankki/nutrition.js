(function () {
  "use strict";

  const meals = {
    breakfast: { label: "아침", icon: "sunrise" },
    lunch: { label: "점심", icon: "sun" },
    dinner: { label: "저녁", icon: "moon" },
    snack: { label: "간식", icon: "snack" },
  };
  const nutrients = {
    energy: { label: "열량", unit: "kcal" },
    carbs: { label: "탄수화물", unit: "g" },
    protein: { label: "단백질", unit: "g" },
    fat: { label: "지방", unit: "g" },
    fiber: { label: "식이섬유", unit: "g" },
    sodium: { label: "나트륨", unit: "mg" },
  };
  const nutrientKeys = Object.keys(nutrients);
  const mealKeys = Object.keys(meals);
  const reference = { fiber: 25, sodium: 2000 };
  const firstDate = "1900-01-01";
  const dayInMs = 86400000;

  function dateKey(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return [date.getFullYear(), month, day].join("-");
  }

  function dateObject(key) {
    return new Date(key + "T00:00:00Z");
  }

  function isDate(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const date = dateObject(key);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
  }

  function changeDay(key, offset) {
    return new Date(dateObject(key).getTime() + offset * dayInMs).toISOString().slice(0, 10);
  }

  function changeMonth(key, offset) {
    const date = dateObject(key);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString().slice(0, 10);
  }

  function datesInPeriod(key, period, today) {
    if (period === "day") return [key];
    const monthStart = key.slice(0, 7) + "-01";
    const start = period === "week" ? changeDay(key, -6) : monthStart;
    const end = period === "week" ? key : changeDay(changeMonth(monthStart, 1), -1);
    const dates = [];
    for (let day = start; day <= end && day <= today; day = changeDay(day, 1)) {
      dates.push(day);
    }
    return dates;
  }

  function gramsOf(input) {
    const grams = Number(input);
    return Number.isFinite(grams) && grams >= 0.1 && grams <= 10000 ? grams : null;
  }

  function amountFor(entry, key) {
    const per100g = entry.food.values[key];
    const grams = gramsOf(entry.grams);
    if (grams === null || per100g === null) return null;
    return per100g * grams / 100;
  }

  function summarize(entries) {
    const totals = {};
    const known = {};
    for (const key of nutrientKeys) {
      totals[key] = 0;
      known[key] = 0;
      for (const entry of entries) {
        const value = amountFor(entry, key);
        if (value === null) continue;
        totals[key] += value;
        known[key] += 1;
      }
    }
    return { count: entries.length, totals, known };
  }

  function valueOf(summary, key) {
    return summary.known[key] ? summary.totals[key] : null;
  }

  function isComplete(summary, key) {
    return summary.count > 0 && summary.known[key] === summary.count;
  }

  function averageOf(days, key) {
    const usable = days.filter(({ summary }) => isComplete(summary, key));
    const total = usable.reduce((sum, { summary }) => sum + summary.totals[key], 0);
    return { value: usable.length ? total / usable.length : null, days: usable };
  }

  function mainContributor(days, key) {
    const foods = new Map();
    for (const { entries } of days) {
      for (const entry of entries) {
        const name = entry.food.name;
        const value = (foods.get(name) || 0) + (amountFor(entry, key) ?? 0);
        foods.set(name, value);
      }
    }
    return [...foods].sort((a, b) => b[1] - a[1])[0] || null;
  }

  function entriesIn(day) {
    return mealKeys.flatMap(key => day.meals[key] || []);
  }

  globalThis.HankkiNutrition = {
    meals, mealKeys, nutrients, nutrientKeys, reference, firstDate,
    dateKey, dateObject, isDate, changeDay, changeMonth, datesInPeriod,
    gramsOf, amountFor, summarize, valueOf, isComplete, averageOf,
    mainContributor, entriesIn,
  };
})();
