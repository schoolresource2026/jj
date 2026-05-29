const DATA_PATH = "./data/school_data.csv";

const WEIGHT_ENERGY = 0.45;
const WEIGHT_SPACE = 0.40;
const WEIGHT_OPERATION = 0.15;

const FIELD_MAP = {
  students: "학생수_합계_계",
  classes: "학급수_합계_계",
  teachers: "교원수_합계_계",
  land_area: "학교용지_합계",
  site_area: "교지면적_계",
  building_area: "교사면적_총계",
  cooling_area: "냉난방면적_총계",
  electricity: "전기_총사용량_kWh",
  water: "상수도_톤",
  gas: "가스_m3",
};

const TEXT_COLUMNS = [
  "지역ID",
  "교육청",
  "구군",
  "비효율_위험등급",
  "주요_비효율유형",
  "AI_추천개선방향",
];

const ENERGY_FEATURES = [
  "학생1인당_전기사용량",
  "면적당_전기사용량",
  "냉난방면적당_전기사용량",
];

const SPACE_FEATURES = [
  "학생1인당_교사면적",
  "학생1인당_학교용지",
  "학생1인당_냉난방면적",
];

const OPERATION_FEATURES = [
  "교원1인당학생수",
  "학급당학생수",
];

let refData = [];

function toNumber(value) {
  if (value === null || value === undefined) return NaN;

  const cleaned = String(value)
    .replace(/\ufeff/g, "")
    .replace(/,/g, "")
    .trim();

  if (cleaned === "") return NaN;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function cleanFloat(value) {
  const num = toNumber(value);
  return Number.isFinite(num) ? num : 0;
}

function round2(value) {
  const num = toNumber(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function formatNumber(value) {
  const num = toNumber(value);
  if (!Number.isFinite(num)) return "-";
  return round2(num).toLocaleString("ko-KR");
}

function safeDiv(a, b) {
  const numerator = toNumber(a);
  const denominator = toNumber(b);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return NaN;
  }

  return numerator / denominator;
}

function meanWithoutNaN(values) {
  const cleanValues = values.filter((v) => Number.isFinite(v));
  if (cleanValues.length === 0) return NaN;
  return cleanValues.reduce((sum, v) => sum + v, 0) / cleanValues.length;
}

function median(values) {
  const cleanValues = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = cleanValues.length;

  if (n === 0) return NaN;

  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    return (cleanValues[mid - 1] + cleanValues[mid]) / 2;
  }

  return cleanValues[mid];
}

function quantile(values, q) {
  const cleanValues = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = cleanValues.length;

  if (n === 0) return NaN;
  if (n === 1) return cleanValues[0];

  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;

  if (cleanValues[base + 1] !== undefined) {
    return cleanValues[base] + rest * (cleanValues[base + 1] - cleanValues[base]);
  }

  return cleanValues[base];
}

function getColumnValues(rows, col) {
  return rows.map((row) => toNumber(row[col])).filter((v) => Number.isFinite(v));
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const nextChar = source[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.replace(/\ufeff/g, "").trim());

  return rows
    .slice(1)
    .filter((r) => r.some((cellValue) => String(cellValue).trim() !== ""))
    .map((r) => {
      const obj = {};

      headers.forEach((header, index) => {
        const rawValue = r[index] !== undefined ? r[index].trim() : "";

        if (TEXT_COLUMNS.includes(header)) {
          obj[header] = rawValue;
        } else {
          const num = toNumber(rawValue);
          obj[header] = Number.isFinite(num) ? num : NaN;
        }
      });

      return obj;
    });
}

function calcDerived(raw) {
  const students = raw["학생수_합계_계"];
  const classes = raw["학급수_합계_계"];
  const teachers = raw["교원수_합계_계"];
  const landArea = raw["학교용지_합계"];
  const siteArea = raw["교지면적_계"];
  const buildingArea = raw["교사면적_총계"];
  const coolingArea = raw["냉난방면적_총계"];
  const electricity = raw["전기_총사용량_kWh"];
  const water = raw["상수도_톤"];
  const gas = raw["가스_m3"];

  return {
    "학생1인당_전기사용량": safeDiv(electricity, students),
    "학생1인당_수도사용량": safeDiv(water, students),
    "학생1인당_가스사용량": safeDiv(gas, students),
    "학급당학생수": safeDiv(students, classes),
    "교원1인당학생수": safeDiv(students, teachers),
    "학생1인당_교원수": safeDiv(teachers, students),
    "학생1인당_학교용지": safeDiv(landArea, students),
    "학생1인당_교지면적": safeDiv(siteArea, students),
    "학생1인당_교사면적": safeDiv(buildingArea, students),
    "학생1인당_냉난방면적": safeDiv(coolingArea, students),
    "면적당_전기사용량": safeDiv(electricity, buildingArea),
    "냉난방면적당_전기사용량": safeDiv(electricity, coolingArea),
  };
}

function rawFromRow(row) {
  const raw = {};

  Object.entries(FIELD_MAP).forEach(([key, col]) => {
    raw[col] = cleanFloat(row[col]);
  });

  return raw;
}

function rawFromForm() {
  const raw = {};

  Object.entries(FIELD_MAP).forEach(([key, col]) => {
    const input = document.getElementById(key);
    raw[col] = input ? cleanFloat(input.value) : 0;
  });

  return raw;
}

function ensureDerivedColumns(rows) {
  return rows.map((row) => {
    const raw = rawFromRow(row);
    const derived = calcDerived(raw);

    Object.keys(derived).forEach((key) => {
      if (!Number.isFinite(toNumber(row[key]))) {
        row[key] = derived[key];
      }
    });

    return row;
  });
}

function robustMinmaxValue(value, referenceValues) {
  const values = referenceValues.filter((v) => Number.isFinite(v));

  if (values.length === 0 || !Number.isFinite(value)) return NaN;

  const lower = quantile(values, 0.01);
  const upper = quantile(values, 0.99);

  const clipped = values.map((v) => Math.min(Math.max(v, lower), upper));
  const minValue = Math.min(...clipped);
  const maxValue = Math.max(...clipped);

  if (minValue === maxValue) return NaN;

  const clippedValue = Math.min(Math.max(value, lower), upper);

  return ((clippedValue - minValue) / (maxValue - minValue)) * 100;
}

function deviationScoreValue(value, referenceValues) {
  const values = referenceValues.filter((v) => Number.isFinite(v));

  if (values.length === 0 || !Number.isFinite(value)) return NaN;

  const med = median(values);
  const userDeviation = Math.abs(value - med);
  const referenceDeviation = values.map((v) => Math.abs(v - med));

  return robustMinmaxValue(userDeviation, referenceDeviation);
}

function calcScores(raw, rows) {
  const derived = calcDerived(raw);

  const energyScores = ENERGY_FEATURES.map((col) => {
    return robustMinmaxValue(derived[col], getColumnValues(rows, col));
  });

  const spaceScores = SPACE_FEATURES.map((col) => {
    return robustMinmaxValue(derived[col], getColumnValues(rows, col));
  });

  const operationScores = OPERATION_FEATURES.map((col) => {
    return deviationScoreValue(derived[col], getColumnValues(rows, col));
  });

  const energyScore = meanWithoutNaN(energyScores);
  const spaceScore = meanWithoutNaN(spaceScores);
  const operationScore = meanWithoutNaN(operationScores);

  const totalInefficiency =
    energyScore * WEIGHT_ENERGY +
    spaceScore * WEIGHT_SPACE +
    operationScore * WEIGHT_OPERATION;

  const efficiencyScore = 100 - totalInefficiency;

  const scores = {
    "에너지_비효율점수": round2(energyScore),
    "공간_과잉점수": round2(spaceScore),
    "운영_구조점수": round2(operationScore),
    "종합_비효율점수": round2(totalInefficiency),
    "교육자원_효율점수": round2(efficiencyScore),
  };

  return { derived, scores };
}

function classifyRisk(totalScore) {
  if (totalScore >= 60) return "높음";
  if (totalScore >= 40) return "보통";
  if (totalScore >= 20) return "낮음";
  return "매우 낮음";
}

function classifyMainType(scores) {
  const typeScores = {
    "에너지 비효율형": scores["에너지_비효율점수"],
    "공간 과잉형": scores["공간_과잉점수"],
    "운영 구조 불균형형": scores["운영_구조점수"],
  };

  return Object.keys(typeScores).reduce((best, current) => {
    return typeScores[current] > typeScores[best] ? current : best;
  });
}

function recommendAction(mainType) {
  if (mainType === "에너지 비효율형") {
    return "전기 사용량 모니터링, 냉난방 운영 시간 조정, 고효율 설비 교체 등 에너지 관리 개선이 필요합니다.";
  }

  if (mainType === "공간 과잉형") {
    return "학생 수 대비 시설 면적이 큰 편이므로 유휴 공간을 방과후 교실, 지역 학습공간, 공유시설 등으로 전환하는 방안을 검토할 수 있습니다.";
  }

  if (mainType === "운영 구조 불균형형") {
    return "학급당 학생 수와 교원 1인당 학생 수의 균형을 점검하고, 공동 교육과정 운영이나 순회교사 배치 등을 검토할 수 있습니다.";
  }

  return "추가적인 데이터 확인이 필요합니다.";
}

function applyScenario(raw, scenarioName, rate) {
  const newRaw = { ...raw };

  if (scenarioName === "전기 사용량 절감") {
    newRaw["전기_총사용량_kWh"] *= 1 - rate / 100;
  } else if (scenarioName === "냉난방 면적 조정") {
    newRaw["냉난방면적_총계"] *= 1 - rate / 100;
    newRaw["전기_총사용량_kWh"] *= 1 - (rate * 0.5) / 100;
  } else if (scenarioName === "유휴 공간 활용") {
    newRaw["교사면적_총계"] *= 1 - rate / 100;
  }

  return newRaw;
}

function findSimilarRegions(raw, rows, selectedId = null, topN = 5) {
  const compareCols = [
    "학생수_합계_계",
    "학급수_합계_계",
    "교원수_합계_계",
    "학교용지_합계",
    "교사면적_총계",
    "냉난방면적_총계",
    "전기_총사용량_kWh",
  ];

  const rowsWithDistance = rows
    .filter((row) => !selectedId || row["지역ID"] !== selectedId)
    .map((row) => {
      let distance = 0;

      compareCols.forEach((col) => {
        const values = getColumnValues(rows, col);
        const avg = meanWithoutNaN(values);
        const variance = meanWithoutNaN(values.map((v) => (v - avg) ** 2));
        const std = Math.sqrt(variance);

        if (!Number.isFinite(std) || std === 0) return;

        const userValue = raw[col];
        const rowValue = row[col];

        if (!Number.isFinite(userValue) || !Number.isFinite(rowValue)) return;

        distance += ((rowValue - userValue) / std) ** 2;
      });

      return {
        ...row,
        거리: Math.sqrt(distance),
      };
    });

  return rowsWithDistance
    .sort((a, b) => a.거리 - b.거리)
    .slice(0, topN);
}

function makeDerivedTable(derived) {
  const labels = {
    "학생1인당_전기사용량": "학생 1인당 전기사용량",
    "학생1인당_수도사용량": "학생 1인당 수도사용량",
    "학생1인당_가스사용량": "학생 1인당 가스사용량",
    "학급당학생수": "학급당 학생 수",
    "교원1인당학생수": "교원 1인당 학생 수",
    "학생1인당_학교용지": "학생 1인당 학교용지",
    "학생1인당_교사면적": "학생 1인당 교사면적",
    "학생1인당_냉난방면적": "학생 1인당 냉난방면적",
    "면적당_전기사용량": "면적당 전기사용량",
    "냉난방면적당_전기사용량": "냉난방면적당 전기사용량",
  };

  return Object.keys(labels).map((key) => {
    const value = derived[key];

    return {
      label: labels[key],
      value: Number.isFinite(value) ? round2(value) : "-",
    };
  });
}

function fillForm(raw) {
  Object.entries(FIELD_MAP).forEach(([key, col]) => {
    const input = document.getElementById(key);
    if (input) {
      input.value = Number.isFinite(raw[col]) ? raw[col] : 0;
    }
  });
}

function getSelectedRow() {
  const select = document.getElementById("regionSelect");
  if (!select) return null;

  const selectedId = select.value;
  return refData.find((row) => row["지역ID"] === selectedId) || refData[0] || null;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function renderDerivedTable(tableRows) {
  const tbody = document.getElementById("derivedTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  tableRows.forEach((item) => {
    const tr = document.createElement("tr");

    const labelTd = document.createElement("td");
    labelTd.textContent = item.label;

    const valueTd = document.createElement("td");
    valueTd.textContent = item.value;

    tr.appendChild(labelTd);
    tr.appendChild(valueTd);
    tbody.appendChild(tr);
  });
}

function renderSimilarRegions(rows) {
  const tbody = document.getElementById("similarRegionsBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const values = [
      row["지역ID"],
      row["교육청"],
      row["구군"],
      formatNumber(row["교육자원_효율점수"]),
      formatNumber(row["종합_비효율점수"]),
      row["비효율_위험등급"],
      row["주요_비효율유형"],
    ];

    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value ?? "-";
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function renderScenarioResults(rows) {
  const tbody = document.getElementById("scenarioResultsBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  rows.forEach((scenario) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = scenario.name;

    const scoreTd = document.createElement("td");
    scoreTd.textContent = `${formatNumber(scenario.new_score)}점`;

    const improvementTd = document.createElement("td");
    const sign = scenario.improvement >= 0 ? "+" : "";
    improvementTd.textContent = `${sign}${formatNumber(scenario.improvement)}점`;

    tr.appendChild(nameTd);
    tr.appendChild(scoreTd);
    tr.appendChild(improvementTd);
    tbody.appendChild(tr);
  });
}

function runDiagnosis(raw, selectedId = null) {
  if (!refData.length) return;

  const rate = cleanFloat(document.getElementById("rate")?.value || 10);

  const { derived, scores } = calcScores(raw, refData);

  const risk = classifyRisk(scores["종합_비효율점수"]);
  const mainType = classifyMainType(scores);
  const recommendation = recommendAction(mainType);

  setText("educationScore", formatNumber(scores["교육자원_효율점수"]));
  setText("inefficiencyScore", formatNumber(scores["종합_비효율점수"]));
  setText("riskGrade", risk);

  setText("mainType", mainType);
  setText("energyScore", formatNumber(scores["에너지_비효율점수"]));
  setText("spaceScore", formatNumber(scores["공간_과잉점수"]));
  setText("operationScore", formatNumber(scores["운영_구조점수"]));
  setText("recommendation", recommendation);

  renderDerivedTable(makeDerivedTable(derived));

  const similarRegions = findSimilarRegions(raw, refData, selectedId);
  renderSimilarRegions(similarRegions);

  const scenarioNames = ["전기 사용량 절감", "냉난방 면적 조정", "유휴 공간 활용"];
  const currentScore = scores["교육자원_효율점수"];

  const scenarioResults = scenarioNames.map((scenarioName) => {
    const newRaw = applyScenario(raw, scenarioName, rate);
    const result = calcScores(newRaw, refData);
    const newScore = result.scores["교육자원_효율점수"];
    const improvement = newScore - currentScore;

    return {
      name: scenarioName,
      new_score: round2(newScore),
      improvement: round2(improvement),
    };
  });

  renderScenarioResults(scenarioResults);

  const bestScenario = scenarioResults.reduce((best, current) => {
    return current.improvement > best.improvement ? current : best;
  });

  setText("bestScenarioName", bestScenario.name);

  const sign = bestScenario.improvement >= 0 ? "+" : "";
  setText("bestScenarioImprovement", `${sign}${formatNumber(bestScenario.improvement)}점`);
}

function populateRegionSelect() {
  const select = document.getElementById("regionSelect");
  if (!select) return;

  select.innerHTML = "";

  refData.forEach((row) => {
    const option = document.createElement("option");
    option.value = row["지역ID"];
    option.textContent = row["지역ID"];
    select.appendChild(option);
  });
}

function loadSelectedRegion() {
  const row = getSelectedRow();

  if (!row) {
    alert("선택된 지역 데이터를 찾을 수 없습니다.");
    return;
  }

  const raw = rawFromRow(row);
  fillForm(raw);
  runDiagnosis(raw, row["지역ID"]);
}

async function init() {
  try {
    const response = await fetch(DATA_PATH);

    if (!response.ok) {
      throw new Error(`CSV 파일을 불러오지 못했습니다. 상태 코드: ${response.status}`);
    }

    const csvText = await response.text();
    refData = ensureDerivedColumns(parseCSV(csvText));

    if (!refData.length) {
      throw new Error("CSV 데이터가 비어 있습니다.");
    }

    populateRegionSelect();
    loadSelectedRegion();

    document.getElementById("loadBtn")?.addEventListener("click", loadSelectedRegion);

    document.getElementById("diagnoseBtn")?.addEventListener("click", () => {
      const selectedRow = getSelectedRow();
      const selectedId = selectedRow ? selectedRow["지역ID"] : null;
      const raw = rawFromForm();
      runDiagnosis(raw, selectedId);
    });

    document.getElementById("diagnosisForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  } catch (error) {
    console.error(error);
    alert(
      "데이터를 불러오는 중 오류가 발생했습니다. data/school_data.csv 경로와 CSV 인코딩을 확인하세요."
    );
  }
}

document.addEventListener("DOMContentLoaded", init);
