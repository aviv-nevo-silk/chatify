FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./
RUN npm install

COPY . .
RUN chmod +x /app/start.sh

EXPOSE 3000

CMD ["/app/start.sh"]
