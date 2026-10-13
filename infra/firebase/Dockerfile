# Emulador de Firebase Auth para desarrollo local (solo APP_ENV=local). Es el mismo servicio que Google ofrece en
# firebase-tools; no hay imagen oficial. El emulador de Auth corre sobre Node, no necesita Java.
# Imagen base: la misma del servidor (fijada por digest).
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
FROM ${NODE_IMAGE}
RUN npm install -g --omit=optional firebase-tools@15.33.0 && npm cache clean --force
RUN mkdir -p /srv && chown node:node /srv
WORKDIR /srv
COPY --chown=node:node firebase.json .
USER node
ENV HOME=/home/node
EXPOSE 9099
# --project: debe coincidir con FIREBASE_PROJECT_ID de la API (el emulador firma tokens con ese "aud").
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "lympha-dev"]
