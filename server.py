import json
import math
import warnings
import threading
import datetime
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.error import URLError

import numpy as np
import pandas as pd
import joblib

warnings.filterwarnings('ignore')

# CONFIG
LAT       = -6.2088
LON       = 106.8456
PORT      = 8765
MODEL_DIR = "."   # folder where server.py lives
REFRESH_INTERVAL = 3600  # 1 jam dalam detik

#  LOAD MODELS 
print("Loading models...")
REG_FEAT = joblib.load(f"{MODEL_DIR}/regresi/feature_cols.pkl")
REG_RF   = joblib.load(f"{MODEL_DIR}/regresi/rf_rainfall_model.pkl")
CLF_FEAT = joblib.load(f"{MODEL_DIR}/klasifikasi/feature_cols_clf.pkl")
CLF_LE   = joblib.load(f"{MODEL_DIR}/klasifikasi/label_encoder.pkl")
CLF_RF   = joblib.load(f"{MODEL_DIR}/klasifikasi/rf_flood_classifier.pkl")
print("Models loaded OK")

# SHARED STATE 
cache_lock = threading.Lock()
prediction_cache = {
    "status": "loading",
    "last_update": None,
    "next_update": None,
    "prediction": None,
    "error": None
}

# FEATURE ENGINEERING 
def fetch_and_predict():
    try:
        # --- Fetch last 3 days + next 1 day from Open-Meteo ---
        variables = [
            "precipitation","temperature_2m","relative_humidity_2m","rain",
            "surface_pressure","cloud_cover","cloud_cover_low","cloud_cover_mid",
            "dew_point_2m","vapour_pressure_deficit","et0_fao_evapotranspiration",
            "wind_speed_10m","wind_direction_10m"
        ]
        params = urlencode({
            "latitude": LAT,
            "longitude": LON,
            "hourly": ",".join(variables),
            "past_days": 3,
            "forecast_days": 1,
            "timezone": "Asia/Jakarta"
        })
        url = f"https://api.open-meteo.com/v1/forecast?{params}"
        with urlopen(url, timeout=20) as resp:
            raw = json.loads(resp.read())

        hourly = raw["hourly"]
        df = pd.DataFrame(hourly)
        df["time"] = pd.to_datetime(df["time"])
        df = df.sort_values("time").reset_index(drop=True)

        # Fill NaN for numerical columns
        num_cols = [c for c in df.columns if c != "time"]
        df[num_cols] = df[num_cols].fillna(0)

        # Temporal features
        df["hour"]  = df["time"].dt.hour
        df["month"] = df["time"].dt.month
        df["dow"]   = df["time"].dt.dayofweek
        df["hour_sin"]  = np.sin(2 * np.pi * df["hour"]  / 24)
        df["hour_cos"]  = np.cos(2 * np.pi * df["hour"]  / 24)
        df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
        df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)
        df["dow_sin"]   = np.sin(2 * np.pi * df["dow"]   / 7)
        df["dow_cos"]   = np.cos(2 * np.pi * df["dow"]   / 7)

        # Wind components
        ws = df["wind_speed_10m"].fillna(0)
        wd = df["wind_direction_10m"].fillna(0)
        df["wind_u"] = -ws * np.sin(np.radians(wd))
        df["wind_v"] = -ws * np.cos(np.radians(wd))

        # Lag features
        for lag in [1, 2, 3, 6, 12, 24]:
            df[f"precip_lag_{lag}h"]   = df["precipitation"].shift(lag).fillna(0)
            df[f"humidity_lag_{lag}h"] = df["relative_humidity_2m"].shift(lag).fillna(0)
            df[f"cloud_lag_{lag}h"]    = df["cloud_cover"].shift(lag).fillna(0)

        # Rolling features
        for w in [3, 6, 12, 24]:
            roll = df["precipitation"].rolling(w, min_periods=1)
            df[f"precip_roll{w}h_mean"] = roll.mean()
            df[f"precip_roll{w}h_std"]  = roll.std().fillna(0)
            df[f"precip_roll{w}h_max"]  = roll.max()
            df[f"precip_roll{w}h_sum"]  = roll.sum()

        df["precip_6h_acc"] = df["precipitation"].rolling(6, min_periods=1).sum()
        df = df.fillna(0)

        # Use latest available row
        latest = df.iloc[-1]
        ts = str(latest["time"])

        # Regression prediction
        X_reg = pd.DataFrame([latest[REG_FEAT].values], columns=REG_FEAT)
        pred_rain = float(REG_RF.predict(X_reg)[0])

        # Classification prediction
        X_clf = pd.DataFrame([latest[CLF_FEAT].values], columns=CLF_FEAT)
        pred_cls_raw  = CLF_RF.predict(X_clf)[0]
        pred_proba    = CLF_RF.predict_proba(X_clf)[0]
        pred_label    = CLF_LE.inverse_transform([pred_cls_raw])[0]

        proba_dict = {
            cls: round(float(p), 4)
            for cls, p in zip(CLF_LE.classes_, pred_proba)
        }

        # Build 24h hourly forecast (use last 24 rows)
        recent = df.tail(24).copy()
        hourly_forecast = []
        for _, row in recent.iterrows():
            X_r = pd.DataFrame([row[REG_FEAT].values], columns=REG_FEAT)
            X_c = pd.DataFrame([row[CLF_FEAT].values], columns=CLF_FEAT)
            hr_rain = float(REG_RF.predict(X_r)[0])
            hr_cls  = CLF_RF.predict(X_c)[0]
            hr_lbl  = CLF_LE.inverse_transform([hr_cls])[0]
            hourly_forecast.append({
                "time":       str(row["time"]),
                "rainfall_pred": round(max(0, hr_rain), 2),
                "risk_label":    hr_lbl,
                "rainfall_actual": round(float(row["precipitation"]), 2),
                "temperature":    round(float(row["temperature_2m"]), 1),
                "humidity":       round(float(row["relative_humidity_2m"]), 1),
            })

        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        next_str = (datetime.datetime.now() + datetime.timedelta(seconds=REFRESH_INTERVAL)).strftime("%Y-%m-%d %H:%M:%S")

        result = {
            "status": "ok",
            "last_update": now_str,
            "next_update": next_str,
            "timestamp":   ts,
            "location": {"lat": LAT, "lon": LON, "name": "DKI Jakarta"},
            "current": {
                "precipitation":   round(float(latest["precipitation"]), 2),
                "temperature":     round(float(latest["temperature_2m"]), 1),
                "humidity":        round(float(latest["relative_humidity_2m"]), 1),
                "cloud_cover":     round(float(latest["cloud_cover"]), 1),
                "surface_pressure":round(float(latest["surface_pressure"]), 1),
            },
            "prediction": {
                "rainfall_next_hour": round(max(0, pred_rain), 2),
                "flood_risk_label":   str(pred_label),
                "flood_risk_proba":   proba_dict,
            },
            "hourly_forecast": hourly_forecast,
            "model_info": {
                "regression":      "RandomForest Regressor (rf_rainfall_model.pkl)",
                "classification":  "RandomForest Classifier (rf_flood_classifier.pkl)",
            }
        }

        with cache_lock:
            prediction_cache.update(result)

        print(f"[{now_str}] Updated — Rain: {pred_rain:.2f} mm/h | Risk: {pred_label}")

    except Exception as e:
        err_msg = str(e)
        print(f"[ERROR] {err_msg}")
        with cache_lock:
            prediction_cache["status"] = "error"
            prediction_cache["error"]  = err_msg
            prediction_cache["last_update"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# BACKGROUND REFRESH
def background_loop():
    while True:
        fetch_and_predict()
        time.sleep(REFRESH_INTERVAL)

# HTTP HANDLER
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress noisy logs

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/prediction":
            with cache_lock:
                data = dict(prediction_cache)
            self.send_json(data)

        elif path == "/api/refresh":
            # Manual force refresh
            threading.Thread(target=fetch_and_predict, daemon=True).start()
            self.send_json({"status": "refreshing"})

        else:
            self.send_json({"error": "Not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

# MAIN 
if __name__ == "__main__":
    # First fetch immediately
    print("Fetching initial data...")
    fetch_and_predict()

    # Background refresh every 1 hour
    t = threading.Thread(target=background_loop, daemon=True)
    t.start()

    # Start server
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"\n✅ Server running at http://127.0.0.1:{PORT}")
    print(f"   API endpoint: http://127.0.0.1:{PORT}/api/prediction")
    print(f"   Manual refresh: http://127.0.0.1:{PORT}/api/refresh")
    print(f"   Auto-refresh every: {REFRESH_INTERVAL//60} menit")
    print("\nBuka dashboard.html di browser.\nCtrl+C untuk stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
