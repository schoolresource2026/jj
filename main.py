from flask import Flask, render_template, request
import pandas as pd
import numpy as np
import os

app = Flask(__name__)

DATA_PATH = os.path.join("data", "school_data.csv")

WEIGHT_ENERGY = 0.45
WEIGHT_SPACE = 0.40
WEIGHT_OPERATION = 0.15

FIELD_MAP = {
    "students": "학생수_합계_계",
    "classes": "학급수_합계_계",
    "teachers": "교원수_합계_계",
    "land_area": "학교용지_합계",
    "site_area": "교지면적_계",
    "building_area": "교사면적_총계",
    "cooling_area": "냉난방면적_총계",
    "electricity": "전기_총사용량_kWh",
    "water": "상수도_톤",
    "gas": "가스_m3",
}

TEXT_COLUMNS = [
    "지역ID",
    "교육청",
    "구군",
    "비효율_위험등급",
    "주요_비효율유형",
    "AI_추천개선방향",
]

ENERGY_FEATURES = [
    "학생1인당_전기사용량",
    "면적당_전기사용량",
    "냉난방면적당_전기사용량",
]

SPACE_FEATURES = [
    "학생1인당_교사면적",
    "학생1인당_학교용지",
    "학생1인당_냉난방면적",
]

OPERATION_FEATURES = [
    "교원1인당학생수",
    "학급당학생수",
]


def load_data():
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError("data 폴더 안에 school_data.csv 파일이 필요합니다.")

    try:
        df = pd.read_csv(DATA_PATH, encoding="utf-8-sig")
    except UnicodeDecodeError:
        df = pd.read_csv(DATA_PATH, encoding="cp949")

    for col in df.columns:
        if col not in TEXT_COLUMNS:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    return df


def safe_div(a, b):
    if b == 0 or pd.isna(b):
        return np.nan
    return a / b


def clean_float(value):
    if pd.isna(value):
        return 0.0
    return float(value)


def raw_from_row(row):
    raw = {}
    for key, col in FIELD_MAP.items():
        raw[col] = clean_float(row.get(col, 0))
    return raw


def form_values_from_raw(raw):
    values = {}
    for key, col in FIELD_MAP.items():
        values[key] = clean_float(raw.get(col, 0))
    return values


def raw_from_form(form):
    raw = {}
    for key, col in FIELD_MAP.items():
        raw[col] = float(form.get(key, 0))
    return raw


def calc_derived(raw):
    students = raw["학생수_합계_계"]
    classes = raw["학급수_합계_계"]
    teachers = raw["교원수_합계_계"]
    land_area = raw["학교용지_합계"]
    site_area = raw["교지면적_계"]
    building_area = raw["교사면적_총계"]
    cooling_area = raw["냉난방면적_총계"]
    electricity = raw["전기_총사용량_kWh"]
    water = raw["상수도_톤"]
    gas = raw["가스_m3"]

    derived = {
        "학생1인당_전기사용량": safe_div(electricity, students),
        "학생1인당_수도사용량": safe_div(water, students),
        "학생1인당_가스사용량": safe_div(gas, students),
        "학급당학생수": safe_div(students, classes),
        "교원1인당학생수": safe_div(students, teachers),
        "학생1인당_교원수": safe_div(teachers, students),
        "학생1인당_학교용지": safe_div(land_area, students),
        "학생1인당_교지면적": safe_div(site_area, students),
        "학생1인당_교사면적": safe_div(building_area, students),
        "학생1인당_냉난방면적": safe_div(cooling_area, students),
        "면적당_전기사용량": safe_div(electricity, building_area),
        "냉난방면적당_전기사용량": safe_div(electricity, cooling_area),
    }

    return derived


def robust_minmax_value(value, reference_series):
    """
    코랩에서 사용한 방식:
    1%~99% 분위수로 극단값을 보정한 뒤 0~100점으로 변환
    """
    s = reference_series.dropna()

    if len(s) == 0 or pd.isna(value):
        return np.nan

    lower = s.quantile(0.01)
    upper = s.quantile(0.99)

    clipped = s.clip(lower=lower, upper=upper)

    min_value = clipped.min()
    max_value = clipped.max()

    if min_value == max_value:
        return np.nan

    value = min(max(value, lower), upper)

    return (value - min_value) / (max_value - min_value) * 100


def deviation_score_value(value, reference_series):
    """
    운영 구조 점수:
    중앙값에서 멀어질수록 비효율 점수가 높아지는 방식
    """
    s = reference_series.dropna()

    if len(s) == 0 or pd.isna(value):
        return np.nan

    median = s.median()
    user_deviation = abs(value - median)
    reference_deviation = (s - median).abs()

    return robust_minmax_value(user_deviation, reference_deviation)


def mean_without_nan(values):
    clean_values = [v for v in values if not pd.isna(v)]

    if len(clean_values) == 0:
        return np.nan

    return sum(clean_values) / len(clean_values)


def calc_scores(raw, ref_df):
    derived = calc_derived(raw)

    energy_scores = []
    for col in ENERGY_FEATURES:
        energy_scores.append(robust_minmax_value(derived[col], ref_df[col]))

    space_scores = []
    for col in SPACE_FEATURES:
        space_scores.append(robust_minmax_value(derived[col], ref_df[col]))

    operation_scores = []
    for col in OPERATION_FEATURES:
        operation_scores.append(deviation_score_value(derived[col], ref_df[col]))

    energy_score = mean_without_nan(energy_scores)
    space_score = mean_without_nan(space_scores)
    operation_score = mean_without_nan(operation_scores)

    total_inefficiency = (
        energy_score * WEIGHT_ENERGY
        + space_score * WEIGHT_SPACE
        + operation_score * WEIGHT_OPERATION
    )

    efficiency_score = 100 - total_inefficiency

    scores = {
        "에너지_비효율점수": round(energy_score, 2),
        "공간_과잉점수": round(space_score, 2),
        "운영_구조점수": round(operation_score, 2),
        "종합_비효율점수": round(total_inefficiency, 2),
        "교육자원_효율점수": round(efficiency_score, 2),
    }

    return derived, scores


def classify_risk(total_score):
    if total_score >= 60:
        return "높음"
    elif total_score >= 40:
        return "보통"
    elif total_score >= 20:
        return "낮음"
    else:
        return "매우 낮음"


def classify_main_type(scores):
    type_scores = {
        "에너지 비효율형": scores["에너지_비효율점수"],
        "공간 과잉형": scores["공간_과잉점수"],
        "운영 구조 불균형형": scores["운영_구조점수"],
    }

    return max(type_scores, key=type_scores.get)


def recommend_action(main_type):
    if main_type == "에너지 비효율형":
        return "전기 사용량 모니터링, 냉난방 운영 시간 조정, 고효율 설비 교체 등 에너지 관리 개선이 필요합니다."

    if main_type == "공간 과잉형":
        return "학생 수 대비 시설 면적이 큰 편이므로 유휴 공간을 방과후 교실, 지역 학습공간, 공유시설 등으로 전환하는 방안을 검토할 수 있습니다."

    if main_type == "운영 구조 불균형형":
        return "학급당 학생 수와 교원 1인당 학생 수의 균형을 점검하고, 공동 교육과정 운영이나 순회교사 배치 등을 검토할 수 있습니다."

    return "추가적인 데이터 확인이 필요합니다."


def apply_scenario(raw, scenario_name, rate):
    new_raw = raw.copy()

    if scenario_name == "전기 사용량 절감":
        new_raw["전기_총사용량_kWh"] *= (1 - rate / 100)

    elif scenario_name == "냉난방 면적 조정":
        new_raw["냉난방면적_총계"] *= (1 - rate / 100)
        new_raw["전기_총사용량_kWh"] *= (1 - rate * 0.5 / 100)

    elif scenario_name == "유휴 공간 활용":
        new_raw["교사면적_총계"] *= (1 - rate / 100)

    return new_raw


def find_similar_regions(raw, ref_df, selected_id=None, top_n=5):
    compare_cols = [
        "학생수_합계_계",
        "학급수_합계_계",
        "교원수_합계_계",
        "학교용지_합계",
        "교사면적_총계",
        "냉난방면적_총계",
        "전기_총사용량_kWh",
    ]

    temp = ref_df.copy()
    distance = 0

    for col in compare_cols:
        if col not in temp.columns:
            continue

        mean = temp[col].mean()
        std = temp[col].std()

        if std == 0 or pd.isna(std):
            continue

        user_value = raw.get(col, np.nan)

        if pd.isna(user_value):
            continue

        distance += ((temp[col] - user_value) / std) ** 2

    temp["거리"] = np.sqrt(distance)

    if selected_id:
        temp = temp[temp["지역ID"] != selected_id]

    show_cols = [
        "지역ID",
        "교육청",
        "구군",
        "교육자원_효율점수",
        "종합_비효율점수",
        "비효율_위험등급",
        "주요_비효율유형",
    ]

    return temp.sort_values("거리").head(top_n)[show_cols].to_dict("records")


def make_derived_table(derived):
    labels = {
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
    }

    table = []

    for key, label in labels.items():
        value = derived.get(key, np.nan)

        if pd.isna(value):
            value = "-"
        else:
            value = round(value, 2)

        table.append({
            "label": label,
            "value": value
        })

    return table


@app.route("/", methods=["GET", "POST"])
def index():
    ref_df = load_data()

    region_options = ref_df["지역ID"].dropna().tolist()

    selected_id = region_options[0]
    rate = 10
    action = "load"

    if request.method == "POST":
        selected_id = request.form.get("region_id", selected_id)
        rate = float(request.form.get("rate", 10))
        action = request.form.get("action", "diagnose")

    selected_row = ref_df[ref_df["지역ID"] == selected_id].iloc[0]

    if request.method == "POST" and action == "diagnose":
        raw = raw_from_form(request.form)
    else:
        raw = raw_from_row(selected_row)

    form_values = form_values_from_raw(raw)

    derived, scores = calc_scores(raw, ref_df)

    risk = classify_risk(scores["종합_비효율점수"])
    main_type = classify_main_type(scores)
    recommendation = recommend_action(main_type)

    scenario_names = [
        "전기 사용량 절감",
        "냉난방 면적 조정",
        "유휴 공간 활용",
    ]

    scenario_results = []
    current_score = scores["교육자원_효율점수"]

    for scenario in scenario_names:
        new_raw = apply_scenario(raw, scenario, rate)
        _, new_scores = calc_scores(new_raw, ref_df)
        new_score = new_scores["교육자원_효율점수"]
        improvement = new_score - current_score

        scenario_results.append({
            "name": scenario,
            "new_score": round(new_score, 2),
            "improvement": round(improvement, 2),
        })

    best_scenario = max(scenario_results, key=lambda x: x["improvement"])

    similar_regions = find_similar_regions(raw, ref_df, selected_id=selected_id)

    result = {
        "selected_id": selected_id,
        "region_name": f"{selected_row['교육청']} {selected_row['구군']}",
        "scores": scores,
        "risk": risk,
        "main_type": main_type,
        "recommendation": recommendation,
        "derived_table": make_derived_table(derived),
        "scenario_results": scenario_results,
        "best_scenario": best_scenario,
        "similar_regions": similar_regions,
        "rate": rate,
    }

    return render_template(
        "index.html",
        region_options=region_options,
        selected_id=selected_id,
        form_values=form_values,
        result=result,
    )


if __name__ == "__main__":
    app.run(debug=True)