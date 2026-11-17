FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/engine.cjs server/server.cjs server/setup.cjs ./
COPY paper-trading.js rsi-mtf.js /app/
COPY index.html styles.css app.js remote-paper.js mobile-ui.js paper-ui.js manifest.webmanifest sw.js /app/
COPY icons /app/icons
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node","server.cjs"]
