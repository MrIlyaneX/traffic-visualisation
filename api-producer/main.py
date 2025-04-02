import pandas as pd
import time
import requests
import logging
import os
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

CSV_FILE = os.getenv("CSV_FILE", "data/data.csv")
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:5000/receive")

def main():
    df = pd.read_csv(CSV_FILE)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], unit="s")
    previous_timestamp = None
    
    for _, row in df.iterrows():
        package = {
            "ip": row["ip address"],
            "latitude": row["Latitude"],
            "longitude": row["Longitude"],
            "timestamp": row["Timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
            "suspicious": row["suspicious"]
        }

        if previous_timestamp is not None:
            sleep_time = (row["Timestamp"] - previous_timestamp).total_seconds()
            time.sleep(max(sleep_time, 0))
        
        response = requests.post(SERVER_URL, json=package)
        logger.info(f"Sent: {package}\tResponse: {response.status_code}")
        
        if response.status_code != 200:
            logger.error("Some error has happened")

        previous_timestamp = row["Timestamp"]

if __name__ == "__main__":
    main()
