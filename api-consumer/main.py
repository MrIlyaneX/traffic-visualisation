import json
import logging
import os
import threading
from datetime import datetime
from queue import Queue
from typing import Any, Generic, TypeVar

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from pydantic import BaseModel

load_dotenv()
package_lock = threading.Lock()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PRODUCER_SERVER_URL = os.getenv("PRODUCER_SERVER_URL", "http://localhost:2080/")
FRONTED_SERVER_URL = os.getenv("FRONTED_SERVER_URL", "http://localhost:5173/")

T = TypeVar("T")
E = TypeVar("E", bound=Any)


app = Flask(__name__)
cors = CORS(
    app,
    resources={r"/stream": {"origins": "*"}, r"/history": {"origins": "*"}},
)


class PackageModel(BaseModel):
    ip: str
    latitude: float
    longitude: float
    timestamp: datetime
    suspicious: int


received_packages: list[PackageModel] = []

package_queue = Queue()
new_package_event = threading.Event()


class Ok(Generic[T]):
    __slots__ = ("value", "is_error")

    def __init__(self, value: T):
        self.value = value
        self.is_error = False

    def __iter__(self):
        yield self.value
        yield self.is_error


class Err(Generic[E]):
    __slots__ = ("value", "is_error")

    def __init__(self):
        self.value = None
        self.is_error = True

    def __iter__(self):
        yield None
        yield self.is_error


def process_data(data):
    try:
        package = PackageModel(**data.get_json())
        return Ok(package)
    except Exception:
        return Err()


def send_data(data: PackageModel):
    pass


@app.route("/receive", methods=["POST"])
def receive_package():
    res, err = process_data(request)

    if err:
        return jsonify({"message": "Error happened"}), 500

    with package_lock:
        received_packages.append(res)
        package_queue.put(res)
        new_package_event.set()

    logger.info(f"Received: {res}")
    return jsonify({"message": "Package received"}), 200


@app.route("/history")
def get_history():
    with package_lock:
        packages_to_send = [pkg for pkg in received_packages]

        historical_packages = []
        for pkg in packages_to_send:
            pkg_dict = pkg.model_dump()
            pkg_dict["timestamp"] = pkg_dict["timestamp"].isoformat()
            historical_packages.append(pkg_dict)

    return jsonify(historical_packages)


# (Server-Sent Events) SSE way to send data to fronend as it comes from the producer
@app.route("/stream")
def stream():
    def event_stream():
        client_id = threading.get_ident()
        logger.info(f"New SSE client connected (ID: {client_id})")
        last_message_id = 0
        try:
            while True:
                package_available = new_package_event.wait(timeout=30)

                if package_available:
                    with package_lock:
                        packages = []
                        while not package_queue.empty():
                            packages.append(package_queue.get())

                        for package in packages:
                            last_message_id += 1
                            try:
                                package_dict = package.model_dump()
                                package_dict["timestamp"] = package_dict[
                                    "timestamp"
                                ].isoformat()
                                package_dict["packege_id"] = last_message_id
                                logger.info(f"Sent: {package_dict}")
                                yield f"id: {last_message_id}\n"
                                yield "event: package\n"
                                yield "retry: 3000\n"
                                yield f"data: {json.dumps(package_dict)}\n\n"
                            except Exception as e:
                                logger.error(f"Package serialization error: {e}")

                        new_package_event.clear()

                yield ":heartbeat\n\n"

        except GeneratorExit:
            logger.info(f"SSE client disconnected (ID: {client_id})")
        except Exception as e:
            logger.error(f"SSE stream error: {str(e)}")

    response = Response(event_stream(), mimetype="text/event-stream")
    response.headers["Connection"] = "keep-alive"
    response.headers["Content-Type"] = "text/event-stream; charset=utf-8"
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Expose-Headers", "*")
    response.headers["X-Accel-Buffering"] = "no"
    response.headers["Cache-Control"] = "no-cache"
    return response


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True, debug=True)
