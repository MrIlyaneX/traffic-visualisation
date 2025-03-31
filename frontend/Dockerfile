FROM node:18-alpine

WORKDIR /app

COPY . /app

RUN npm install three@0.152.2 serve

# RUN npm i -g serve

# RUN npm run build

EXPOSE 5173

CMD [ "npx", "serve", "-l", "5173", "."]
