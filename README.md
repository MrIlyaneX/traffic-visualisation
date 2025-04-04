# Internet Package Traffic Visualisation

The app represented as 3 containers:

- api-producer: reads .csv data and sends it to /receive endpoint

- api-consumer: get data from /receive endpoint, create SSE connection with frontend with ability to request all previous data an /history endpoint

- frontend: Visualize data in real time using SSE

Load order is important (configured in docker-compose file, but in some cases the order get messed up - re-run the docker compose):

1. api-consumer
2. frontend
3. api-producer

## Running

In the project root run:

```cmd
docker-compose up --build
```
