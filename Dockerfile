FROM mhart/alpine-node:4.4.7
MAINTAINER Qing Yan <admin@zensh.com>

LABEL info.name="teambition snapper" \
      info.version="2.7.7"

RUN mkdir -p /var/snapper

COPY ./app.js ./rpc.js ./package.json ./npm-shrinkwrap.json /var/snapper/
COPY ./config/default.json5 /var/snapper/config/
COPY ./lib /var/snapper/lib/

WORKDIR /var/snapper
RUN apk add --no-cache bash git && \
  rm -rf /usr/share/man /tmp/* /var/cache/apk/* && \
  npm i --production
